//! `rebase`, `rebase_todo_load` and `rebase_interactive`.
//!
//! Interactive rebases never open an editor. The generated todo is written
//! to `<gitdir>/gittrunk/rebase-<n>/todo` and `GIT_SEQUENCE_EDITOR` is set to
//! `cp '<todo>'`. git runs editor commands through its own `sh` (also on
//! Windows, where that is the `sh` bundled with Git for Windows) as
//! `cp '<todo>' "$@"`, so the file it would have offered for editing is
//! overwritten with ours. Paths use forward slashes, which every Windows
//! `sh` and `cp` accepts. Message changes are expressed as
//! `exec git commit --amend --no-verify -F '<msgfile>'` lines after the
//! `pick`/`squash` they belong to, one message file per item.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use git2::{Oid, Repository};

use super::sim::{simulate, SimOp, SimStep};
use super::*;

/// Directory below the git dir that holds the temp files of interactive
/// rebases. They must outlive the first `git rebase` call: `exec` lines run
/// again after a conflict or `edit` stop is continued.
fn temp_root(repo: &Repository) -> PathBuf {
    repo.path().join("gittrunk")
}

/// Removes leftover `rebase-*` temp directories once no rebase is running.
pub(super) fn cleanup_temp(repo: &Repository) {
    if in_progress(repo) {
        return;
    }
    let Ok(entries) = fs::read_dir(temp_root(repo)) else {
        return;
    };
    for e in entries.flatten() {
        if e.file_name().to_string_lossy().starts_with("rebase-") {
            let _ = fs::remove_dir_all(e.path());
        }
    }
}

// ------------------------------------------------------------ plain rebase

pub(super) fn rebase(
    repo: &Repository,
    request: &RebaseRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    ensure_idle(repo)?;
    let onto = resolve_commit(repo, &request.onto)?.id();
    let current = current_branch(repo);
    let branch = request
        .branch
        .as_deref()
        .map(|b| local_branch(repo, b))
        .transpose()?;
    if branch.as_ref().is_some_and(|b| Some(b) != current.as_ref()) {
        ensure_clean_tracked(repo)?;
    }
    let (ref_name, label, tip) = match &branch {
        Some(b) => (
            format!("refs/heads/{b}"),
            b.clone(),
            repo.find_branch(b, git2::BranchType::Local)?
                .get()
                .peel_to_commit()?
                .id(),
        ),
        None => (
            head_ref_name(repo),
            current.clone().unwrap_or_else(|| "HEAD".into()),
            head_commit(repo)?.id(),
        ),
    };
    let up_to_date = onto == tip || repo.graph_descendant_of(tip, onto)?;
    let mut steps = Vec::new();
    for oid in range_oldest_first(repo, tip, onto)? {
        if repo.find_commit(oid)?.parent_count() <= 1 {
            steps.push(SimStep {
                oid,
                op: SimOp::Pick,
            });
        }
    }
    let onto_label = request.onto.trim();
    let summary = if up_to_date {
        format!("Rebase {label} onto {onto_label}: already up to date")
    } else {
        format!(
            "Rebase {label} onto {onto_label} ({} commit(s) replayed)",
            steps.len()
        )
    };
    if dry_run {
        if up_to_date {
            return preview_outcome(repo, summary, &[], 0, Vec::new(), Vec::new());
        }
        // Replays every commit with in-memory cherry-picks; git's skipping of
        // commits already applied upstream (patch-id) is not simulated.
        let sim = simulate(repo, onto, &steps)?;
        let mut planned = Vec::new();
        let mut warnings = Vec::new();
        if sim.conflicts.is_empty() {
            planned.push(PlannedUpdate::new(ref_name, Some(tip), Some(sim.tip)));
        } else {
            warnings.push("the rebase will stop on conflicts".to_string());
        }
        return preview_outcome(
            repo,
            summary,
            &planned,
            sim.created,
            warnings,
            sim.conflicts,
        );
    }
    let mut cmd = args(&["rebase"]);
    cmd.push(onto.to_string());
    if let Some(b) = &branch {
        cmd.push(b.clone());
    }
    let (stop, entry) = record(repo, "rebase", summary, |repo| {
        let out = run_git(repo, &cmd, &[])?;
        interpret(repo, out)
    })?;
    outcome(
        repo,
        stop,
        entry,
        format!("Rebased {label} onto {onto_label}"),
    )
}

// ------------------------------------------------------------- todo / load

fn parse_base(repo: &Repository, base: &str) -> AppResult<Oid> {
    let head = head_commit(repo)?.id();
    let base = resolve_hex(repo, base)?.id();
    if base != head && !repo.graph_descendant_of(head, base)? {
        return Err(invalid("the base commit is not an ancestor of HEAD"));
    }
    Ok(base)
}

/// Commits in `base..HEAD`, oldest first; merges are not supported.
fn todo_range(repo: &Repository, base: Oid) -> AppResult<Vec<Oid>> {
    let head = head_commit(repo)?.id();
    let range = range_oldest_first(repo, head, base)?;
    for oid in &range {
        if repo.find_commit(*oid)?.parent_count() > 1 {
            return Err(invalid(format!(
                "the range contains the merge commit {}; interactive rebase of merges is not supported",
                short(*oid)
            )));
        }
    }
    Ok(range)
}

pub(super) fn todo_load(repo: &Repository, base: &str) -> AppResult<Vec<RebaseTodoItem>> {
    let base = parse_base(repo, base)?;
    todo_range(repo, base)?
        .into_iter()
        .map(|oid| {
            let c = repo.find_commit(oid)?;
            Ok(RebaseTodoItem {
                action: RebaseAction::Pick,
                oid: oid.to_string(),
                summary: c.summary().ok().flatten().unwrap_or("").to_string(),
                message: None,
            })
        })
        .collect()
}

// ------------------------------------------------------------- interactive

struct Checked {
    base: Oid,
    /// Kept items (drops removed), in the requested order.
    items: Vec<(Oid, RebaseAction, Option<String>)>,
    dropped: usize,
    range_len: usize,
    identity: bool,
}

fn validate(repo: &Repository, request: &InteractiveRebaseRequest) -> AppResult<Checked> {
    let base = parse_base(repo, &request.base)?;
    let range = todo_range(repo, base)?;
    let in_range: HashSet<Oid> = range.iter().copied().collect();
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    let mut dropped = 0;
    for item in &request.todo {
        let oid = resolve_hex(repo, &item.oid)?.id();
        if !in_range.contains(&oid) {
            return Err(invalid(format!(
                "commit {} is not in the rebased range",
                short(oid)
            )));
        }
        if !seen.insert(oid) {
            return Err(invalid(format!("commit {} appears twice", short(oid))));
        }
        if let Some(m) = &item.message {
            if m.trim().is_empty() {
                return Err(invalid(format!(
                    "the message for commit {} is empty",
                    short(oid)
                )));
            }
        }
        if item.action == RebaseAction::Drop {
            dropped += 1;
        } else {
            items.push((oid, item.action, item.message.clone()));
        }
    }
    dropped += range.len() - seen.len();
    if items.is_empty() {
        return Err(invalid(
            "cannot drop every commit; use reset to move the branch instead",
        ));
    }
    if matches!(items[0].1, RebaseAction::Squash | RebaseAction::Fixup) {
        return Err(invalid("the first commit cannot be squash or fixup"));
    }
    let identity = dropped == 0
        && items.len() == range.len()
        && items
            .iter()
            .zip(&range)
            .all(|((o, a, m), r)| o == r && *a == RebaseAction::Pick && m.is_none());
    Ok(Checked {
        base,
        items,
        dropped,
        range_len: range.len(),
        identity,
    })
}

fn sh_quote(path: &Path) -> String {
    format!(
        "'{}'",
        path.to_string_lossy()
            .replace('\\', "/")
            .replace('\'', "'\\''")
    )
}

/// Writes the todo and message files; returns the todo path.
fn write_todo(repo: &Repository, checked: &Checked) -> AppResult<PathBuf> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = temp_root(repo).join(format!("rebase-{stamp}"));
    fs::create_dir_all(&dir)?;
    let mut todo = String::new();
    for (n, (oid, action, message)) in checked.items.iter().enumerate() {
        let verb = match action {
            RebaseAction::Pick => "pick",
            RebaseAction::Reword => "pick",
            RebaseAction::Edit => "edit",
            RebaseAction::Squash => "squash",
            RebaseAction::Fixup => "fixup",
            RebaseAction::Drop => continue,
        };
        todo.push_str(&format!("{verb} {oid}\n"));
        let amend = match action {
            RebaseAction::Reword => message.as_ref(),
            RebaseAction::Squash => message.as_ref(),
            _ => None,
        };
        // `reword` without a new message stays a plain pick.
        if let Some(m) = amend {
            let file = dir.join(format!("msg-{n}.txt"));
            let mut text = m.trim_end().to_string();
            text.push('\n');
            fs::write(&file, text)?;
            todo.push_str(&format!(
                "exec git commit --amend --no-verify -F {}\n",
                sh_quote(&file)
            ));
        }
    }
    let path = dir.join("todo");
    fs::write(&path, todo)?;
    Ok(path)
}

pub(super) fn interactive(
    repo: &Repository,
    request: &InteractiveRebaseRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    ensure_idle(repo)?;
    let checked = validate(repo, request)?;
    let tip = head_commit(repo)?.id();
    let count = |a: RebaseAction| checked.items.iter().filter(|i| i.1 == a).count();
    let folded = count(RebaseAction::Squash) + count(RebaseAction::Fixup);
    let summary = if checked.identity {
        "Interactive rebase: nothing changes".to_string()
    } else {
        format!(
            "Interactive rebase of {} commit(s): {} kept, {} dropped, {} squashed, {} reworded",
            checked.range_len,
            checked.items.len() - folded,
            checked.dropped,
            folded,
            count(RebaseAction::Reword)
        )
    };
    if dry_run {
        if checked.identity {
            return preview_outcome(repo, summary, &[], 0, Vec::new(), Vec::new());
        }
        let steps: Vec<SimStep> = checked
            .items
            .iter()
            .map(|(oid, action, message)| SimStep {
                oid: *oid,
                op: match (action, message) {
                    (RebaseAction::Reword, Some(m)) => SimOp::Reword(m.clone()),
                    (RebaseAction::Squash, m) => SimOp::Squash(m.clone()),
                    (RebaseAction::Fixup, _) => SimOp::Fixup,
                    _ => SimOp::Pick,
                },
            })
            .collect();
        let sim = simulate(repo, checked.base, &steps)?;
        let mut planned = Vec::new();
        let mut warnings = Vec::new();
        if sim.conflicts.is_empty() {
            planned.push(PlannedUpdate::new(
                head_ref_name(repo),
                Some(tip),
                Some(sim.tip),
            ));
        } else {
            warnings.push("the rebase will stop on conflicts".to_string());
        }
        if count(RebaseAction::Edit) > 0 {
            warnings.push("the rebase will pause at each commit marked edit".to_string());
        }
        return preview_outcome(
            repo,
            summary,
            &planned,
            sim.created,
            warnings,
            sim.conflicts,
        );
    }

    cleanup_temp(repo);
    let todo = write_todo(repo, &checked)?;
    let editor = format!("cp {}", sh_quote(&todo));
    let cmd = vec!["rebase".to_string(), "-i".into(), checked.base.to_string()];
    let result = record(repo, "rebase_interactive", summary, |repo| {
        let out = run_git(repo, &cmd, &[("GIT_SEQUENCE_EDITOR", editor)])?;
        interpret(repo, out)
    });
    cleanup_temp(repo);
    let (stop, entry) = result?;
    outcome(
        repo,
        stop,
        entry,
        format!("Rebased {} commit(s)", checked.range_len),
    )
}

#[cfg(test)]
pub(super) fn sh_quote_for_test(path: &str) -> String {
    sh_quote(Path::new(path))
}
