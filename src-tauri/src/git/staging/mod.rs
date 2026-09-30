//! Working-copy writes: staging, line-level staging, discard and commit.
//! Kept in its own trait so it does not touch `GitService`.

pub(crate) mod commit;
pub mod patch;

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use git2::build::CheckoutBuilder;
use git2::{
    ApplyLocation, Delta, Diff, DiffFindOptions, FileMode, IndexAddOption, IndexEntry, IndexTime,
    ObjectType, Patch, Repository, TreeWalkMode, TreeWalkResult,
};

use crate::git::cli::GitCli;
use crate::git::libgit::repo::head_state;
use crate::git::libgit::LibGit;
use crate::git::oplog::Oplog;
use crate::git::preview;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;
use patch::{Direction, RawFile, RawHunk, RawLine};

pub trait StagingService: Send + Sync {
    fn stage_paths(&self, repo: &Repository, paths: &[String]) -> AppResult<()>;
    fn unstage_paths(&self, repo: &Repository, paths: &[String]) -> AppResult<()>;
    fn stage_lines(&self, repo: &Repository, selection: &LineSelection) -> AppResult<()>;
    fn unstage_lines(&self, repo: &Repository, selection: &LineSelection) -> AppResult<()>;
    fn discard_paths(
        &self,
        repo: &Repository,
        paths: &[String],
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    fn discard_lines(
        &self,
        repo: &Repository,
        selection: &LineSelection,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    fn commit_create(
        &self,
        repo: &Repository,
        cli: &GitCli,
        request: &CommitRequest,
    ) -> AppResult<OpOutcome>;
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

fn workdir(repo: &Repository) -> AppResult<&Path> {
    repo.workdir()
        .ok_or_else(|| invalid("this operation needs a working tree (bare repository)"))
}

/// Normalises a repository-relative path and rejects anything that could
/// escape the working tree or touch `.git`.
fn clean_path(p: &str) -> AppResult<String> {
    let n = p.replace('\\', "/");
    let n = n.trim_end_matches('/');
    let bad = n.is_empty()
        || n.starts_with('/')
        || n.contains('\0')
        || n.as_bytes().get(1) == Some(&b':')
        || n.split('/')
            .any(|c| c.is_empty() || c == "." || c == ".." || c.eq_ignore_ascii_case(".git"));
    if bad {
        return Err(invalid(format!(
            "`{p}` is not a valid repository-relative path"
        )));
    }
    Ok(n.to_string())
}

fn clean_paths(paths: &[String]) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    for p in paths {
        let c = clean_path(p)?;
        if !out.contains(&c) {
            out.push(c);
        }
    }
    Ok(out)
}

fn applied(repo: &Repository, oplog_id: String, message: String) -> AppResult<OpOutcome> {
    Ok(OpOutcome::Applied {
        oplog_id,
        head: head_state(repo)?,
        message,
    })
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

fn mode_string(mode: FileMode) -> AppResult<&'static str> {
    match mode {
        FileMode::Blob => Ok("100644"),
        FileMode::BlobExecutable => Ok("100755"),
        _ => Err(invalid(
            "line-level operations only support regular files; use the whole-file action",
        )),
    }
}

/// Re-diffs `path` (staged: HEAD to index, otherwise index to working tree)
/// with exactly `options`, as `worktree_file_diff` does, keeping raw bytes.
fn load_file(
    repo: &Repository,
    path: &str,
    staged: bool,
    options: &DiffOptions,
) -> AppResult<RawFile> {
    if options.ignore_whitespace {
        return Err(invalid(
            "line-level operations require ignore_whitespace to be off",
        ));
    }
    let norm = clean_path(path)?;
    repo.index()?.read(false)?;
    let mut opts = git2::DiffOptions::new();
    opts.context_lines(options.context_lines)
        .ignore_whitespace(false);
    let diff: Diff<'_> = if staged {
        let tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        let mut d = repo.diff_tree_to_index(tree.as_ref(), None, Some(&mut opts))?;
        let mut find = DiffFindOptions::new();
        find.renames(true);
        d.find_similar(Some(&mut find))?;
        d
    } else {
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true)
            .disable_pathspec_match(true)
            .pathspec(&norm);
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };
    let as_str = |p: Option<&Path>| p.map(|p| p.to_string_lossy().replace('\\', "/"));
    let idx = (0..diff.deltas().len()).find(|&i| {
        diff.get_delta(i).is_some_and(|d| {
            let new = as_str(d.new_file().path());
            let old = as_str(d.old_file().path());
            new.as_deref() == Some(&norm)
                || (d.status() == Delta::Deleted && old.as_deref() == Some(&norm))
        })
    });
    let Some(idx) = idx else {
        return Err(invalid(format!("`{norm}` has no changes to select from")));
    };
    let delta = diff
        .get_delta(idx)
        .ok_or_else(|| AppError::new(ErrorKind::Internal, "diff delta vanished"))?;
    let status = match delta.status() {
        Delta::Added => ChangeStatus::Added,
        Delta::Deleted => ChangeStatus::Deleted,
        Delta::Modified => ChangeStatus::Modified,
        Delta::Untracked => ChangeStatus::Untracked,
        Delta::Renamed | Delta::Copied => return Err(invalid(
            "line-level operations are not supported for renamed files; use the whole-file action",
        )),
        _ => {
            return Err(invalid(
                "line-level operations are not supported for this kind of change",
            ))
        }
    };
    if delta.flags().is_binary() {
        return Err(invalid("binary files cannot be staged line by line"));
    }
    let mode_side = if status == ChangeStatus::Deleted {
        delta.old_file().mode()
    } else {
        delta.new_file().mode()
    };
    let mode = mode_string(mode_side)?.to_string();
    let mut hunks = Vec::new();
    if let Some(patch) = Patch::from_diff(&diff, idx)? {
        if patch.delta().flags().is_binary() {
            return Err(invalid("binary files cannot be staged line by line"));
        }
        for h in 0..patch.num_hunks() {
            let (hunk, count) = patch.hunk(h)?;
            let mut lines = Vec::with_capacity(count);
            for l in 0..count {
                let line = patch.line_in_hunk(h, l)?;
                let origin = match line.origin() {
                    '+' => '+',
                    '-' => '-',
                    '=' | '>' | '<' => '\\',
                    _ => ' ',
                };
                lines.push(RawLine {
                    origin,
                    content: line.content().to_vec(),
                });
            }
            hunks.push(RawHunk {
                old_start: hunk.old_start(),
                old_lines: hunk.old_lines(),
                new_start: hunk.new_start(),
                new_lines: hunk.new_lines(),
                lines,
            });
        }
    }
    Ok(RawFile {
        status,
        mode,
        hunks,
    })
}

fn apply_patch(repo: &Repository, bytes: &[u8], location: ApplyLocation) -> AppResult<()> {
    let diff = Diff::from_buffer(bytes)?;
    repo.apply(&diff, location, None).map_err(|e| {
        if e.code() == git2::ErrorCode::ApplyFail || e.class() == git2::ErrorClass::Patch {
            AppError::new(
                ErrorKind::Conflict,
                format!("the selection no longer applies: {}", e.message()),
            )
        } else {
            e.into()
        }
    })?;
    if matches!(location, ApplyLocation::Index) {
        let mut index = repo.index()?;
        index.read(true)?;
    }
    Ok(())
}

fn workdir_missing(workdir: &Path, rel: &str) -> bool {
    matches!(
        fs::symlink_metadata(workdir.join(rel)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound
    )
}

/// Files touched by discarding `paths`: (path, status) of the unstaged diff.
fn unstaged_changes(repo: &Repository, paths: &[String]) -> AppResult<Vec<(String, Delta)>> {
    repo.index()?.read(false)?;
    let mut opts = git2::DiffOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(false)
        .disable_pathspec_match(true);
    for p in paths {
        opts.pathspec(p);
    }
    let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;
    let mut out = Vec::new();
    for d in diff.deltas() {
        let path = if d.status() == Delta::Deleted {
            d.old_file().path()
        } else {
            d.new_file().path()
        };
        if let Some(p) = path {
            out.push((p.to_string_lossy().replace('\\', "/"), d.status()));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

fn remove_untracked(workdir: &Path, rel: &str) -> AppResult<()> {
    let abs = workdir.join(rel);
    match fs::symlink_metadata(&abs) {
        Ok(m) if m.is_dir() => fs::remove_dir_all(&abs)?,
        Ok(_) => fs::remove_file(&abs)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    // Drop directories that became empty.
    let mut dir = abs.parent().map(Path::to_path_buf);
    while let Some(d) = dir {
        if d == workdir || fs::remove_dir(&d).is_err() {
            break;
        }
        dir = d.parent().map(Path::to_path_buf);
    }
    Ok(())
}

impl StagingService for LibGit {
    fn stage_paths(&self, repo: &Repository, paths: &[String]) -> AppResult<()> {
        let workdir = workdir(repo)?;
        let paths = clean_paths(paths)?;
        let mut index = repo.index()?;
        index.read(true)?;
        for p in &paths {
            let prefix = format!("{p}/");
            let gone_under = |index: &git2::Index| -> Vec<String> {
                index
                    .iter()
                    .map(|e| String::from_utf8_lossy(&e.path).into_owned())
                    .filter(|e| e.starts_with(&prefix) && workdir_missing(workdir, e))
                    .collect()
            };
            match fs::symlink_metadata(workdir.join(p)) {
                Ok(m) if m.is_dir() => {
                    for g in gone_under(&index) {
                        index.remove_path(Path::new(&g))?;
                    }
                    index.add_all([p.as_str()], IndexAddOption::DISABLE_PATHSPEC_MATCH, None)?;
                }
                Ok(_) => index.add_path(Path::new(p))?,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    let _ = index.remove_path(Path::new(p));
                    for g in gone_under(&index) {
                        index.remove_path(Path::new(&g))?;
                    }
                }
                Err(e) => return Err(e.into()),
            }
        }
        index.write()?;
        Ok(())
    }

    fn unstage_paths(&self, repo: &Repository, paths: &[String]) -> AppResult<()> {
        let paths = clean_paths(paths)?;
        let mut index = repo.index()?;
        index.read(true)?;
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        let mut targets = BTreeSet::new();
        for p in &paths {
            targets.insert(p.clone());
            let prefix = format!("{p}/");
            for e in index.iter() {
                let path = String::from_utf8_lossy(&e.path).into_owned();
                if path.starts_with(&prefix) {
                    targets.insert(path);
                }
            }
            let sub = head_tree
                .as_ref()
                .and_then(|t| t.get_path(Path::new(p)).ok())
                .filter(|e| e.kind() == Some(ObjectType::Tree));
            if let Some(entry) = sub {
                let tree = entry.to_object(repo)?.peel_to_tree()?;
                tree.walk(TreeWalkMode::PreOrder, |root, e| {
                    if e.kind() == Some(ObjectType::Blob) {
                        if let Ok(name) = e.name() {
                            targets.insert(format!("{p}/{root}{name}"));
                        }
                    }
                    TreeWalkResult::Ok
                })?;
            }
        }
        for t in targets {
            let in_head = head_tree
                .as_ref()
                .and_then(|tr| tr.get_path(Path::new(&t)).ok())
                .filter(|e| e.kind() == Some(ObjectType::Blob));
            match in_head {
                Some(e) => index.add(&IndexEntry {
                    ctime: IndexTime::new(0, 0),
                    mtime: IndexTime::new(0, 0),
                    dev: 0,
                    ino: 0,
                    mode: e.filemode() as u32,
                    uid: 0,
                    gid: 0,
                    file_size: 0,
                    id: e.id(),
                    flags: 0,
                    flags_extended: 0,
                    path: t.into_bytes(),
                })?,
                None => {
                    let _ = index.remove_path(Path::new(&t));
                }
            }
        }
        index.write()?;
        Ok(())
    }

    fn stage_lines(&self, repo: &Repository, selection: &LineSelection) -> AppResult<()> {
        let file = load_file(repo, &selection.path, false, &selection.options)?;
        let path = clean_path(&selection.path)?;
        match patch::build(&file, &path, Direction::Forward, &selection.hunks)? {
            Some(p) => apply_patch(repo, &p.bytes, ApplyLocation::Index),
            None => Ok(()),
        }
    }

    fn unstage_lines(&self, repo: &Repository, selection: &LineSelection) -> AppResult<()> {
        let file = load_file(repo, &selection.path, true, &selection.options)?;
        let path = clean_path(&selection.path)?;
        match patch::build(&file, &path, Direction::Reverse, &selection.hunks)? {
            Some(p) => apply_patch(repo, &p.bytes, ApplyLocation::Index),
            None => Ok(()),
        }
    }

    fn discard_paths(
        &self,
        repo: &Repository,
        paths: &[String],
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        let workdir = workdir(repo)?;
        let paths = clean_paths(paths)?;
        let changes: Vec<(String, Delta)> = unstaged_changes(repo, &paths)?
            .into_iter()
            .filter(|(_, d)| *d != Delta::Conflicted)
            .collect();
        if changes.is_empty() {
            return Err(invalid("no unstaged changes to discard"));
        }
        let summary = format!(
            "Discard unstaged changes in {}",
            plural(changes.len(), "file", "files")
        );
        if dry_run {
            let warnings = changes
                .iter()
                .map(|(p, d)| match d {
                    Delta::Untracked => format!("{p}: untracked file will be deleted"),
                    Delta::Deleted => format!("{p}: deleted file will be restored"),
                    _ => format!("{p}: unstaged changes will be lost"),
                })
                .collect();
            let preview = preview::build(repo, summary, &[], 0, warnings, Vec::new())?;
            return Ok(OpOutcome::Preview { preview });
        }
        let ((), entry) = Oplog::record(repo, "discard_paths", summary.clone(), true, |repo| {
            let mut restore = Vec::new();
            for (p, d) in &changes {
                if *d == Delta::Untracked {
                    remove_untracked(workdir, p)?;
                } else {
                    restore.push(p.clone());
                }
            }
            if !restore.is_empty() {
                let mut index = repo.index()?;
                index.read(true)?;
                let mut cb = CheckoutBuilder::new();
                cb.force().disable_pathspec_match(true);
                for p in &restore {
                    cb.path(p);
                }
                repo.checkout_index(Some(&mut index), Some(&mut cb))?;
            }
            Ok(())
        })?;
        applied(repo, entry.id, summary)
    }

    fn discard_lines(
        &self,
        repo: &Repository,
        selection: &LineSelection,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        workdir(repo)?;
        let file = load_file(repo, &selection.path, false, &selection.options)?;
        let path = clean_path(&selection.path)?;
        let Some(built) = patch::build(&file, &path, Direction::Reverse, &selection.hunks)? else {
            return Err(invalid("the selection contains no changed lines"));
        };
        let summary = format!("Discard {} in {path}", plural(built.lines, "line", "lines"));
        if dry_run {
            let warnings = vec![format!(
                "{path}: {} in {} will be lost",
                plural(built.lines, "changed line", "changed lines"),
                plural(built.hunks, "hunk", "hunks")
            )];
            let preview = preview::build(repo, summary, &[], 0, warnings, Vec::new())?;
            return Ok(OpOutcome::Preview { preview });
        }
        let ((), entry) = Oplog::record(repo, "discard_lines", summary.clone(), true, |repo| {
            apply_patch(repo, &built.bytes, ApplyLocation::WorkDir)
        })?;
        applied(repo, entry.id, summary)
    }

    fn commit_create(
        &self,
        repo: &Repository,
        cli: &GitCli,
        request: &CommitRequest,
    ) -> AppResult<OpOutcome> {
        commit::commit_create(repo, cli, request)
    }
}

#[cfg(test)]
mod tests;
