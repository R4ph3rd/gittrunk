//! Commit details, file diffs and working-tree status.

use std::collections::HashSet;
use std::path::Path;

use git2::{Delta, Diff, DiffFindOptions, Patch, Repository, Tree};

use super::refs::ref_labels;
use super::repo::repo_state;
use super::{parse_oid, signature};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

fn diff_opts(options: &DiffOptions) -> git2::DiffOptions {
    let mut o = git2::DiffOptions::new();
    o.context_lines(options.context_lines)
        .ignore_whitespace(options.ignore_whitespace);
    o
}

fn find_renames(diff: &mut Diff<'_>) -> AppResult<()> {
    let mut opts = DiffFindOptions::new();
    opts.renames(true);
    diff.find_similar(Some(&mut opts))?;
    Ok(())
}

fn map_status(delta: Delta) -> Option<ChangeStatus> {
    Some(match delta {
        Delta::Added => ChangeStatus::Added,
        Delta::Deleted => ChangeStatus::Deleted,
        Delta::Modified => ChangeStatus::Modified,
        Delta::Renamed => ChangeStatus::Renamed,
        Delta::Copied => ChangeStatus::Copied,
        Delta::Typechange => ChangeStatus::TypeChange,
        Delta::Untracked => ChangeStatus::Untracked,
        Delta::Conflicted => ChangeStatus::Conflicted,
        Delta::Unmodified | Delta::Ignored | Delta::Unreadable => return None,
    })
}

fn path_string(p: Option<&Path>) -> String {
    p.map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/// (new path, old path) of a delta; the new path is the old one for deletions.
fn delta_paths(delta: &git2::DiffDelta<'_>) -> (String, Option<String>) {
    let old = path_string(delta.old_file().path());
    let new = path_string(delta.new_file().path());
    let path = if delta.status() == Delta::Deleted {
        old.clone()
    } else {
        new
    };
    let old_path = matches!(delta.status(), Delta::Renamed | Delta::Copied).then_some(old);
    (path, old_path)
}

fn file_changes(diff: &Diff<'_>, skip: &HashSet<String>) -> AppResult<Vec<FileChange>> {
    let mut out = Vec::new();
    for idx in 0..diff.deltas().len() {
        let Some(delta) = diff.get_delta(idx) else {
            continue;
        };
        let Some(status) = map_status(delta.status()) else {
            continue;
        };
        let (path, old_path) = delta_paths(&delta);
        if skip.contains(&path) {
            continue;
        }
        let (mut additions, mut deletions) = (0, 0);
        let mut binary = delta.flags().is_binary();
        if let Some(patch) = Patch::from_diff(diff, idx)? {
            let (_, a, d) = patch.line_stats()?;
            additions = a as u32;
            deletions = d as u32;
            binary = patch.delta().flags().is_binary();
        }
        out.push(FileChange {
            path,
            old_path,
            status,
            additions,
            deletions,
            binary,
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn patch_to_file_diff(diff: &Diff<'_>, idx: usize) -> AppResult<FileDiff> {
    let delta = diff
        .get_delta(idx)
        .ok_or_else(|| AppError::new(ErrorKind::Internal, "diff delta vanished"))?;
    let (path, old_path) = delta_paths(&delta);
    let status = map_status(delta.status()).unwrap_or(ChangeStatus::Modified);
    let mut binary = delta.flags().is_binary();
    let mut hunks = Vec::new();
    if let Some(patch) = Patch::from_diff(diff, idx)? {
        binary = patch.delta().flags().is_binary();
        for h in 0..patch.num_hunks() {
            let (hunk, line_count) = patch.hunk(h)?;
            let mut lines = Vec::with_capacity(line_count);
            for l in 0..line_count {
                let line = patch.line_in_hunk(h, l)?;
                let kind = match line.origin() {
                    '+' => LineKind::Add,
                    '-' => LineKind::Delete,
                    '=' | '>' | '<' => LineKind::NoNewline,
                    _ => LineKind::Context,
                };
                let content = String::from_utf8_lossy(line.content());
                let content = content.strip_suffix('\n').unwrap_or(&content).to_string();
                let (old_lineno, new_lineno) = if kind == LineKind::NoNewline {
                    (None, None)
                } else {
                    (line.old_lineno(), line.new_lineno())
                };
                lines.push(DiffLine {
                    kind,
                    old_lineno,
                    new_lineno,
                    content,
                });
            }
            hunks.push(Hunk {
                header: String::from_utf8_lossy(hunk.header())
                    .trim_end_matches(['\n', '\r'])
                    .to_string(),
                old_start: hunk.old_start(),
                old_lines: hunk.old_lines(),
                new_start: hunk.new_start(),
                new_lines: hunk.new_lines(),
                lines,
            });
        }
    }
    Ok(FileDiff {
        path,
        old_path,
        status,
        binary,
        hunks,
    })
}

/// Index of the delta that concerns `path` (new path first, then old path).
fn find_delta(diff: &Diff<'_>, path: &str) -> Option<usize> {
    let path = path.replace('\\', "/");
    let mut by_old = None;
    for idx in 0..diff.deltas().len() {
        let delta = diff.get_delta(idx)?;
        if path_string(delta.new_file().path()) == path {
            return Some(idx);
        }
        if by_old.is_none() && path_string(delta.old_file().path()) == path {
            by_old = Some(idx);
        }
    }
    by_old
}

fn empty_diff(path: &str) -> FileDiff {
    FileDiff {
        path: path.to_string(),
        old_path: None,
        status: ChangeStatus::Modified,
        binary: false,
        hunks: Vec::new(),
    }
}

fn commit_diff<'r>(
    repo: &'r Repository,
    commit: &git2::Commit<'r>,
    opts: Option<&mut git2::DiffOptions>,
) -> AppResult<Diff<'r>> {
    let tree = commit.tree()?;
    let parent_tree = match commit.parents().next() {
        Some(p) => Some(p.tree()?),
        None => None,
    };
    let mut diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), opts)?;
    find_renames(&mut diff)?;
    Ok(diff)
}

pub fn commit_details(repo: &Repository, oid: &str) -> AppResult<CommitDetails> {
    let id = parse_oid(oid)?;
    let commit = repo.find_commit(id)?;
    let diff = commit_diff(repo, &commit, None)?;
    let files = file_changes(&diff, &HashSet::new())?;
    let mut labels = ref_labels(repo)?;
    let message = String::from_utf8_lossy(commit.message_bytes()).into_owned();
    let summary = String::from_utf8_lossy(commit.summary_bytes().unwrap_or_default()).into_owned();
    let body = commit
        .body_bytes()
        .map(|b| String::from_utf8_lossy(b).trim_end().to_string())
        .unwrap_or_else(|| {
            message
                .strip_prefix(&summary)
                .unwrap_or_default()
                .trim()
                .to_string()
        });
    let (author, committer) = (signature(&commit.author()), signature(&commit.committer()));
    Ok(CommitDetails {
        oid: id.to_string(),
        parents: commit.parent_ids().map(|p| p.to_string()).collect(),
        author,
        committer,
        summary,
        body,
        files,
        refs: labels.remove(&id).unwrap_or_default(),
    })
}

pub fn commit_file_diff(
    repo: &Repository,
    oid: &str,
    path: &str,
    options: &DiffOptions,
) -> AppResult<FileDiff> {
    let commit = repo.find_commit(parse_oid(oid)?)?;
    let mut opts = diff_opts(options);
    let diff = commit_diff(repo, &commit, Some(&mut opts))?;
    let idx = find_delta(&diff, path).ok_or_else(|| {
        AppError::new(
            ErrorKind::InvalidInput,
            format!("`{path}` is not changed by commit {oid}"),
        )
    })?;
    patch_to_file_diff(&diff, idx)
}

fn head_tree(repo: &Repository) -> Option<Tree<'_>> {
    repo.head().ok().and_then(|h| h.peel_to_tree().ok())
}

fn refresh_index(repo: &Repository) -> AppResult<()> {
    if repo.is_bare() {
        return Ok(());
    }
    repo.index()?.read(false)?;
    Ok(())
}

fn workdir_opts() -> git2::DiffOptions {
    let mut o = git2::DiffOptions::new();
    o.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    o
}

pub fn worktree_file_diff(
    repo: &Repository,
    path: &str,
    staged: bool,
    options: &DiffOptions,
) -> AppResult<FileDiff> {
    refresh_index(repo)?;
    let norm = path.replace('\\', "/");
    if staged {
        let mut opts = diff_opts(options);
        let tree = head_tree(repo);
        let mut diff = repo.diff_tree_to_index(tree.as_ref(), None, Some(&mut opts))?;
        find_renames(&mut diff)?;
        return match find_delta(&diff, &norm) {
            Some(idx) => patch_to_file_diff(&diff, idx),
            None => Ok(empty_diff(&norm)),
        };
    }
    let mut opts = diff_opts(options);
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true)
        .disable_pathspec_match(true)
        .pathspec(&norm);
    let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;
    match find_delta(&diff, &norm) {
        Some(idx) => patch_to_file_diff(&diff, idx),
        None => Ok(empty_diff(&norm)),
    }
}

fn conflicted_files(repo: &Repository) -> AppResult<Vec<FileChange>> {
    let index = repo.index()?;
    if !index.has_conflicts() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for c in index.conflicts()? {
        let c = c?;
        let entry = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref());
        let Some(entry) = entry else { continue };
        let path = String::from_utf8_lossy(&entry.path).into_owned();
        if seen.insert(path.clone()) {
            out.push(FileChange {
                path,
                old_path: None,
                status: ChangeStatus::Conflicted,
                additions: 0,
                deletions: 0,
                binary: false,
            });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

pub fn status(repo: &Repository) -> AppResult<StatusSnapshot> {
    refresh_index(repo)?;
    let conflicted = conflicted_files(repo)?;
    let skip: HashSet<String> = conflicted.iter().map(|c| c.path.clone()).collect();

    let tree = head_tree(repo);
    let mut staged_diff = repo.diff_tree_to_index(tree.as_ref(), None, None)?;
    find_renames(&mut staged_diff)?;
    let staged = file_changes(&staged_diff, &skip)?;

    let unstaged = if repo.is_bare() {
        Vec::new()
    } else {
        let mut opts = workdir_opts();
        let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;
        file_changes(&diff, &skip)?
    };

    Ok(StatusSnapshot {
        state: repo_state(repo),
        staged,
        unstaged,
        conflicted,
    })
}
