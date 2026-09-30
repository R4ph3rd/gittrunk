//! Builds exactly what an AI request would send: a system prompt (static app
//! text) and a user message (repository content). `ai_payload_preview`
//! returns the user message verbatim.

use git2::{Diff, Oid, Patch, Repository, Tree};

use crate::git::conflicts::ConflictService;
use crate::git::libgit::repo::{head_state, repo_state};
use crate::git::libgit::LibGit;
use crate::git::service::GitService;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub const COMMIT_MESSAGE_PROMPT: &str = include_str!("prompts/commit_message.md");
pub const CONFLICT_PROMPT: &str = include_str!("prompts/conflict.md");
pub const SUMMARIZE_PROMPT: &str = include_str!("prompts/summarize.md");
pub const PR_DESCRIPTION_PROMPT: &str = include_str!("prompts/pr_description.md");
pub const PLAN_PROMPT: &str = include_str!("prompts/plan.md");

const MAX_SUBJECTS: usize = 50;

#[derive(Debug, Clone)]
pub struct Payload {
    pub system: &'static str,
    /// The user message: the exact text sent to the provider.
    pub content: String,
    pub files: Vec<String>,
    pub truncated: bool,
    pub max_tokens: u32,
}

impl Payload {
    pub fn preview(&self) -> AiPayloadPreview {
        AiPayloadPreview {
            bytes: self.content.len().min(u32::MAX as usize) as u32,
            files: self.files.clone(),
            truncated: self.truncated,
            content: self.content.clone(),
        }
    }
}

pub fn build(repo: &mut Repository, request: &AiRequest, max_bytes: usize) -> AppResult<Payload> {
    match request {
        AiRequest::CommitMessage => commit_message(repo, max_bytes),
        AiRequest::ConflictSuggestion { path } => conflict(repo, path, max_bytes),
        AiRequest::Summarize { target } => match target {
            SummaryTarget::Commit { oid } => summarize_commit(repo, oid, max_bytes),
            SummaryTarget::Branch { name, base } => summarize_branch(repo, name, base),
        },
        AiRequest::PrDescription { base, head } => pr_description(repo, base, head, max_bytes),
        AiRequest::Plan { prompt } => plan(repo, prompt),
    }
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

// ------------------------------------------------------------------ diffs

struct FilePatch {
    path: String,
    additions: usize,
    deletions: usize,
    text: String,
}

fn collect(diff: &Diff<'_>) -> AppResult<Vec<FilePatch>> {
    let mut out = Vec::new();
    for idx in 0..diff.deltas().len() {
        let Some(delta) = diff.get_delta(idx) else {
            continue;
        };
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let Some(mut patch) = Patch::from_diff(diff, idx)? else {
            continue;
        };
        let (_, additions, deletions) = patch.line_stats()?;
        let buf = patch.to_buf()?;
        out.push(FilePatch {
            path,
            additions,
            deletions,
            text: String::from_utf8_lossy(&buf).into_owned(),
        });
    }
    Ok(out)
}

fn stat(files: &[FilePatch]) -> String {
    let mut s = String::new();
    for f in files {
        s.push_str(&format!("{} | +{} -{}\n", f.path, f.additions, f.deletions));
    }
    let (a, d) = files
        .iter()
        .fold((0, 0), |(a, d), f| (a + f.additions, d + f.deletions));
    s.push_str(&format!("{} file(s) changed, +{a} -{d}\n", files.len()));
    s
}

fn cut_at_line(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    match text[..end].rfind('\n') {
        Some(nl) => &text[..=nl],
        None => &text[..end],
    }
}

/// Concatenates whole file patches while they fit in `max` bytes. Files that
/// do not fit are omitted and named in a trailing note; when even the first
/// file is too large it is cut at a line boundary instead.
fn assemble(files: &[FilePatch], max: usize) -> (String, Vec<String>, bool) {
    let mut out = String::new();
    let mut included = Vec::new();
    let mut omitted: Vec<&str> = Vec::new();
    let mut cut_first = false;
    for (i, f) in files.iter().enumerate() {
        if !omitted.is_empty() {
            omitted.push(&f.path);
        } else if out.len() + f.text.len() <= max {
            out.push_str(&f.text);
            if !f.text.ends_with('\n') {
                out.push('\n');
            }
            included.push(f.path.clone());
        } else if i == 0 {
            out.push_str(cut_at_line(&f.text, max));
            included.push(f.path.clone());
            cut_first = true;
        } else {
            omitted.push(&f.path);
        }
    }
    let truncated = cut_first || !omitted.is_empty();
    if truncated {
        let mut note = format!("\n[diff truncated at {max} bytes");
        if cut_first {
            note.push_str(&format!("; {} was cut mid-file", included[0]));
        }
        if !omitted.is_empty() {
            let shown: Vec<&str> = omitted.iter().take(20).copied().collect();
            note.push_str(&format!(
                "; {} file(s) omitted: {}",
                omitted.len(),
                shown.join(", ")
            ));
            if omitted.len() > shown.len() {
                note.push_str(&format!(" (+{} more)", omitted.len() - shown.len()));
            }
        }
        note.push_str("]\n");
        out.push_str(&note);
    }
    (out, included, truncated)
}

fn diff_body(files: &[FilePatch], max: usize) -> (String, Vec<String>, bool) {
    let (patches, included, truncated) = assemble(files, max);
    let mut s = String::from("Diff stat:\n");
    s.push_str(&stat(files));
    s.push_str("\nDiff:\n");
    s.push_str(&patches);
    (s, included, truncated)
}

fn head_tree(repo: &Repository) -> Option<Tree<'_>> {
    repo.head().ok().and_then(|h| h.peel_to_tree().ok())
}

fn commit_of<'r>(repo: &'r Repository, spec: &str) -> AppResult<git2::Commit<'r>> {
    if spec.trim().is_empty() || spec.starts_with('-') {
        return Err(invalid(format!("`{spec}` is not a valid revision")));
    }
    repo.revparse_single(spec)
        .and_then(|o| o.peel_to_commit())
        .map_err(|_| {
            AppError::new(
                ErrorKind::RefNotFound,
                format!("cannot resolve `{spec}` to a commit"),
            )
        })
}

// ------------------------------------------------------------------ requests

fn commit_message(repo: &Repository, max: usize) -> AppResult<Payload> {
    let mut opts = git2::DiffOptions::new();
    let tree = head_tree(repo);
    let mut diff = repo.diff_tree_to_index(tree.as_ref(), None, Some(&mut opts))?;
    diff.find_similar(None)?;
    let files = collect(&diff)?;
    if files.is_empty() {
        return Err(invalid(
            "Nothing is staged, so there is nothing to describe",
        ));
    }
    let (body, included, truncated) = diff_body(&files, max);
    Ok(Payload {
        system: COMMIT_MESSAGE_PROMPT,
        content: format!("Staged changes:\n\n{body}"),
        files: included,
        truncated,
        max_tokens: 500,
    })
}

fn conflict(repo: &Repository, path: &str, max: usize) -> AppResult<Payload> {
    let file = LibGit.conflict_file(repo, path)?;
    if file.binary {
        return Err(invalid("Binary files cannot be resolved with AI"));
    }
    let side = |name: &str, label: &str, text: &Option<String>| match text {
        Some(t) => format!("=== {name} ({label}) ===\n{t}\n"),
        None => format!("=== {name} ({label}) ===\n[file does not exist on this side]\n"),
    };
    let content = format!(
        "File: {}\n\n{}\n{}\n{}",
        file.path,
        side("BASE", "common ancestor", &file.base),
        side("OURS", &file.ours_label, &file.ours),
        side("THEIRS", &file.theirs_label, &file.theirs),
    );
    if content.len() > max {
        return Err(invalid(format!(
            "The conflicted file is larger than the {max} byte AI limit; resolve it manually or raise the limit in AI settings"
        )));
    }
    Ok(Payload {
        system: CONFLICT_PROMPT,
        content,
        files: vec![file.path],
        truncated: false,
        max_tokens: 16_000,
    })
}

fn commit_diff<'r>(repo: &'r Repository, commit: &git2::Commit<'r>) -> AppResult<Diff<'r>> {
    let tree = commit.tree()?;
    let parent = commit.parents().next().map(|p| p.tree()).transpose()?;
    let mut diff = repo.diff_tree_to_tree(parent.as_ref(), Some(&tree), None)?;
    diff.find_similar(None)?;
    Ok(diff)
}

fn summarize_commit(repo: &Repository, oid: &str, max: usize) -> AppResult<Payload> {
    let id = Oid::from_str(oid).map_err(|_| invalid(format!("invalid object id `{oid}`")))?;
    let commit = repo.find_commit(id)?;
    let files = collect(&commit_diff(repo, &commit)?)?;
    let (body, included, truncated) = diff_body(&files, max);
    let message = String::from_utf8_lossy(commit.message_bytes()).into_owned();
    Ok(Payload {
        system: SUMMARIZE_PROMPT,
        content: format!(
            "Summarize this commit.\n\nCommit {}\nMessage:\n{}\n\n{body}",
            id,
            message.trim_end()
        ),
        files: included,
        truncated,
        max_tokens: 700,
    })
}

/// `base..head` subjects (newest first) and the merge-base..head diff files.
fn range(
    repo: &Repository,
    base: &str,
    head: &str,
) -> AppResult<(Vec<String>, usize, Vec<FilePatch>)> {
    let base_c = commit_of(repo, base)?;
    let head_c = commit_of(repo, head)?;
    let mut walk = repo.revwalk()?;
    walk.push(head_c.id())?;
    walk.hide(base_c.id())?;
    let mut subjects = Vec::new();
    let mut total = 0;
    for id in walk {
        let c = repo.find_commit(id?)?;
        total += 1;
        if subjects.len() < MAX_SUBJECTS {
            subjects.push(format!(
                "{} {}",
                &c.id().to_string()[..7],
                c.summary().ok().flatten().unwrap_or("")
            ));
        }
    }
    let from = match repo.merge_base(base_c.id(), head_c.id()) {
        Ok(mb) => repo.find_commit(mb)?.tree()?,
        Err(_) => base_c.tree()?,
    };
    let mut diff = repo.diff_tree_to_tree(Some(&from), Some(&head_c.tree()?), None)?;
    diff.find_similar(None)?;
    Ok((subjects, total, collect(&diff)?))
}

fn subjects_block(subjects: &[String], total: usize) -> String {
    let mut s = format!("Commits ({total}):\n");
    for line in subjects {
        s.push_str(&format!("- {line}\n"));
    }
    if total > subjects.len() {
        s.push_str(&format!("- ... and {} more\n", total - subjects.len()));
    }
    s
}

fn summarize_branch(repo: &Repository, name: &str, base: &str) -> AppResult<Payload> {
    let (subjects, total, files) = range(repo, base, name)?;
    Ok(Payload {
        system: SUMMARIZE_PROMPT,
        content: format!(
            "Summarize the branch `{name}` relative to `{base}`.\n\n{}\nDiff stat:\n{}",
            subjects_block(&subjects, total),
            stat(&files)
        ),
        files: files.iter().map(|f| f.path.clone()).collect(),
        truncated: false,
        max_tokens: 700,
    })
}

fn pr_description(repo: &Repository, base: &str, head: &str, max: usize) -> AppResult<Payload> {
    let (subjects, total, files) = range(repo, base, head)?;
    if total == 0 {
        return Err(invalid(format!(
            "`{head}` has no commits that are not in `{base}`"
        )));
    }
    let (body, included, truncated) = diff_body(&files, max);
    Ok(Payload {
        system: PR_DESCRIPTION_PROMPT,
        content: format!(
            "Draft a pull request description for `{head}` into `{base}`.\n\n{}\n{body}",
            subjects_block(&subjects, total)
        ),
        files: included,
        truncated,
        max_tokens: 1_500,
    })
}

pub const MAX_PROMPT_CHARS: usize = 4_000;

fn plan(repo: &mut Repository, prompt: &str) -> AppResult<Payload> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(invalid("Describe what you want to do"));
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(invalid(format!(
            "The request is longer than {MAX_PROMPT_CHARS} characters"
        )));
    }
    let mut ctx = String::new();
    match head_state(repo)? {
        HeadState::Branch { name, oid } => {
            ctx.push_str(&format!("Current branch: {name} (at {oid})\n"))
        }
        HeadState::Detached { oid } => ctx.push_str(&format!("HEAD is detached at {oid}\n")),
        HeadState::Unborn { name } => {
            ctx.push_str(&format!("Current branch: {name} (no commits yet)\n"))
        }
    }
    ctx.push_str(&format!("Repository state: {:?}\n", repo_state(repo)));
    let refs = LibGit.refs_list(repo)?;
    ctx.push_str("Local branches:\n");
    for b in &refs.local {
        ctx.push_str(&format!("- {}", b.name));
        if let Some(up) = &b.upstream {
            ctx.push_str(&format!(
                " (upstream {up}, ahead {}, behind {})",
                b.ahead, b.behind
            ));
        }
        if b.is_head {
            ctx.push_str(" [current]");
        }
        ctx.push('\n');
    }
    let remotes: Vec<String> = repo
        .remotes()?
        .iter()
        .flatten()
        .flatten()
        .map(|r| r.to_string())
        .collect();
    ctx.push_str(&format!(
        "Remotes: {}\n",
        if remotes.is_empty() {
            "none".to_string()
        } else {
            remotes.join(", ")
        }
    ));
    ctx.push_str("Last commits (newest first):\n");
    if let Ok(mut walk) = repo.revwalk() {
        if walk.push_head().is_ok() {
            for id in walk.take(10).flatten() {
                if let Ok(c) = repo.find_commit(id) {
                    ctx.push_str(&format!(
                        "- {} {}\n",
                        id,
                        c.summary().ok().flatten().unwrap_or("")
                    ));
                }
            }
        }
    }
    Ok(Payload {
        system: PLAN_PROMPT,
        content: format!("Repository:\n{ctx}\nRequest:\n{prompt}\n"),
        files: Vec::new(),
        truncated: false,
        max_tokens: 3_000,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::fixtures;

    fn big(n: usize) -> String {
        (0..n).map(|i| format!("line {i}\n")).collect()
    }

    #[test]
    fn commit_message_uses_staged_diff_only() {
        let mut t = fixtures::TestRepo::new();
        t.write("a.txt", "one\n");
        t.commit_all("init");
        t.write("a.txt", "one\ntwo\n");
        t.write("b.txt", "unstaged\n");
        {
            let mut idx = t.repo.index().unwrap();
            idx.add_path(std::path::Path::new("a.txt")).unwrap();
            idx.write().unwrap();
        }
        let p = build(&mut t.repo, &AiRequest::CommitMessage, 60_000).unwrap();
        assert_eq!(p.files, vec!["a.txt"]);
        assert!(p.content.contains("+two"));
        assert!(!p.content.contains("unstaged"));
        assert!(!p.truncated);
        assert_eq!(p.preview().bytes as usize, p.content.len());
    }

    #[test]
    fn nothing_staged_is_invalid_input() {
        let (mut t, _) = fixtures::linear(1);
        let err = build(&mut t.repo, &AiRequest::CommitMessage, 60_000).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput);
    }

    #[test]
    fn truncates_at_file_boundaries_with_note() {
        let mut t = fixtures::TestRepo::new();
        t.write("seed.txt", "x\n");
        t.commit_all("init");
        t.write("a.txt", big(40));
        t.write("b.txt", big(40));
        t.write("c.txt", big(40));
        t.stage_all();
        let one_file = big(40).len() + 300;
        let p = build(&mut t.repo, &AiRequest::CommitMessage, one_file).unwrap();
        assert!(p.truncated);
        assert_eq!(p.files, vec!["a.txt"]);
        assert!(p.content.contains("diff truncated"));
        assert!(p.content.contains("b.txt, c.txt"));
        // The stat still lists every file.
        assert!(p.content.contains("c.txt | +40 -0"));
        assert!(!p.content.contains("diff --git a/b.txt"));
    }

    #[test]
    fn first_file_too_large_is_cut_at_a_line() {
        let mut t = fixtures::TestRepo::new();
        t.write("seed.txt", "x\n");
        t.commit_all("init");
        t.write("huge.txt", big(500));
        t.stage_all();
        let p = build(&mut t.repo, &AiRequest::CommitMessage, 400).unwrap();
        assert!(p.truncated);
        assert!(p.content.contains("huge.txt was cut mid-file"));
    }

    #[test]
    fn conflict_payload_has_three_sides_and_labels() {
        let mut t = fixtures::conflicted_merge();
        let p = build(
            &mut t.repo,
            &AiRequest::ConflictSuggestion {
                path: "conflict.txt".into(),
            },
            60_000,
        )
        .unwrap();
        assert!(p.content.contains("=== BASE"));
        assert!(p.content.contains("main side"));
        assert!(p.content.contains("other side"));
        assert_eq!(p.files, vec!["conflict.txt"]);
        let err = build(
            &mut t.repo,
            &AiRequest::ConflictSuggestion {
                path: "conflict.txt".into(),
            },
            10,
        )
        .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput);
    }

    #[test]
    fn summarize_commit_and_branch_and_pr() {
        let mut t = fixtures::TestRepo::new();
        t.write("a.txt", "a\n");
        let base = t.commit_all("base");
        t.checkout_branch("feature", base);
        let tip = t.commit_on("feature", "f.txt", "feature\n", "feat: add f");
        let p = build(
            &mut t.repo,
            &AiRequest::Summarize {
                target: SummaryTarget::Commit {
                    oid: tip.to_string(),
                },
            },
            60_000,
        )
        .unwrap();
        assert!(p.content.contains("feat: add f") && p.content.contains("+feature"));
        let p = build(
            &mut t.repo,
            &AiRequest::Summarize {
                target: SummaryTarget::Branch {
                    name: "feature".into(),
                    base: "main".into(),
                },
            },
            60_000,
        )
        .unwrap();
        assert!(p.content.contains("feat: add f") && p.content.contains("f.txt | +1 -0"));
        assert!(!p.content.contains("+feature\n"));
        let p = build(
            &mut t.repo,
            &AiRequest::PrDescription {
                base: "main".into(),
                head: "feature".into(),
            },
            60_000,
        )
        .unwrap();
        assert!(p.content.contains("+feature"));
        let err = build(
            &mut t.repo,
            &AiRequest::PrDescription {
                base: "feature".into(),
                head: "main".into(),
            },
            60_000,
        )
        .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput);
    }

    #[test]
    fn plan_context_lists_branches_remotes_and_commits() {
        let (mut t, oids) = fixtures::linear(3);
        t.repo
            .remote("origin", "https://example.com/x.git")
            .unwrap();
        let p = build(
            &mut t.repo,
            &AiRequest::Plan {
                prompt: "make a branch".into(),
            },
            60_000,
        )
        .unwrap();
        assert!(p.content.contains("Current branch: main"));
        assert!(p.content.contains("Remotes: origin"));
        assert!(p.content.contains(&oids[2].to_string()));
        assert!(p.content.contains("Request:\nmake a branch"));
        assert!(build(
            &mut t.repo,
            &AiRequest::Plan {
                prompt: "  ".into()
            },
            1
        )
        .is_err());
    }
}
