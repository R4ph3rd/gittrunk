//! Conflict inspection and resolution. Kept in its own trait so it does not
//! touch `GitService`. Reads use libgit2 (index stages 1/2/3); staging the
//! resolution goes through `git add` / `git rm` so hooks and attributes behave
//! like git.

use std::fs;
use std::path::{Component, Path};

use git2::{Index, IndexConflict, IndexEntry, Repository};

use crate::git::cli::GitCli;
use crate::git::libgit::LibGit;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub trait ConflictService: Send + Sync {
    fn conflict_list(&self, repo: &Repository) -> AppResult<Vec<FileChange>>;
    fn conflict_file(&self, repo: &Repository, path: &str) -> AppResult<ConflictFile>;
    fn conflict_resolve(
        &self,
        repo: &Repository,
        path: &str,
        resolution: &ConflictResolution,
    ) -> AppResult<()>;
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

fn entry_path(e: &IndexEntry) -> String {
    String::from_utf8_lossy(&e.path).into_owned()
}

fn conflict_path(c: &IndexConflict) -> Option<String> {
    c.our
        .as_ref()
        .or(c.their.as_ref())
        .or(c.ancestor.as_ref())
        .map(entry_path)
}

fn fresh_index(repo: &Repository) -> AppResult<Index> {
    let mut index = repo.index()?;
    index.read(true)?;
    Ok(index)
}

/// Sorted paths that are conflicted in the on-disk index.
pub fn conflicted_paths(repo: &Repository) -> AppResult<Vec<String>> {
    let index = fresh_index(repo)?;
    if !index.has_conflicts() {
        return Ok(Vec::new());
    }
    let mut paths: Vec<String> = index
        .conflicts()?
        .flatten()
        .filter_map(|c| conflict_path(&c))
        .collect();
    paths.sort();
    paths.dedup();
    Ok(paths)
}

/// Rejects absolute paths and `..` so a path can never leave the worktree.
fn check_rel_path(path: &str) -> AppResult<()> {
    if path.is_empty() || path.contains('\0') {
        return Err(invalid("empty or malformed path"));
    }
    let p = Path::new(path);
    if p.is_absolute()
        || p.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(invalid(format!(
            "`{path}` is not a path inside the working tree"
        )));
    }
    Ok(())
}

fn find_conflict(repo: &Repository, path: &str) -> AppResult<IndexConflict> {
    check_rel_path(path)?;
    let index = fresh_index(repo)?;
    let wanted = path.replace('\\', "/");
    for c in index.conflicts()?.flatten() {
        if conflict_path(&c).as_deref() == Some(wanted.as_str()) {
            return Ok(c);
        }
    }
    Err(invalid(format!("`{path}` is not conflicted")))
}

fn blob_bytes(repo: &Repository, entry: &Option<IndexEntry>) -> AppResult<Option<Vec<u8>>> {
    match entry {
        None => Ok(None),
        Some(e) => Ok(Some(repo.find_blob(e.id)?.content().to_vec())),
    }
}

fn short_summary(repo: &Repository, oid: git2::Oid) -> String {
    let hex = oid.to_string();
    match repo.find_commit(oid) {
        Ok(c) => format!(
            "{} {}",
            &hex[..7],
            c.summary().ok().flatten().unwrap_or_default()
        ),
        Err(_) => hex[..7].to_string(),
    }
}

fn read_oid_file(repo: &Repository, name: &str) -> Option<git2::Oid> {
    let text = fs::read_to_string(repo.path().join(name)).ok()?;
    git2::Oid::from_str(text.lines().next()?.trim()).ok()
}

/// Branch name quoted in the first line of `MERGE_MSG`
/// (`Merge branch 'feature'`, `Merge remote-tracking branch 'origin/x'`, ...).
fn merge_msg_source(repo: &Repository) -> Option<String> {
    let text = fs::read_to_string(repo.path().join("MERGE_MSG")).ok()?;
    let line = text.lines().next()?;
    let start = line.find('\'')? + 1;
    let end = start + line[start..].find('\'')?;
    let name = &line[start..end];
    // `Merge commit '<sha>'` names no branch.
    let is_sha = name.len() >= 7 && name.bytes().all(|b| b.is_ascii_hexdigit());
    (!is_sha).then(|| name.to_string())
}

/// `(ours, theirs)` labels for the operation in progress.
fn side_labels(repo: &Repository) -> (String, String) {
    let ours = match repo.head() {
        Ok(h) if !repo.head_detached().unwrap_or(false) => {
            h.shorthand().unwrap_or("HEAD").to_string()
        }
        Ok(h) => h
            .target()
            .map(|o| short_summary(repo, o))
            .unwrap_or_else(|| "HEAD".into()),
        Err(_) => "HEAD".into(),
    };
    let merging = repo.path().join("MERGE_HEAD").exists();
    let theirs = match merge_msg_source(repo).filter(|_| merging) {
        Some(name) => name,
        None => [
            "REBASE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "MERGE_HEAD",
        ]
        .iter()
        .find_map(|f| read_oid_file(repo, f))
        .map(|o| short_summary(repo, o))
        .unwrap_or_else(|| "incoming".into()),
    };
    (ours, theirs)
}

fn workdir(repo: &Repository) -> AppResult<&Path> {
    repo.workdir()
        .ok_or_else(|| invalid("repository has no working tree"))
}

impl ConflictService for LibGit {
    fn conflict_list(&self, repo: &Repository) -> AppResult<Vec<FileChange>> {
        Ok(conflicted_paths(repo)?
            .into_iter()
            .map(|path| FileChange {
                path,
                old_path: None,
                status: ChangeStatus::Conflicted,
                additions: 0,
                deletions: 0,
                binary: false,
            })
            .collect())
    }

    fn conflict_file(&self, repo: &Repository, path: &str) -> AppResult<ConflictFile> {
        let c = find_conflict(repo, path)?;
        let base = blob_bytes(repo, &c.ancestor)?;
        let ours = blob_bytes(repo, &c.our)?;
        let theirs = blob_bytes(repo, &c.their)?;
        let is_text = |b: &[u8]| !b.contains(&0) && std::str::from_utf8(b).is_ok();
        let merged_bytes =
            fs::read(workdir(repo)?.join(path.replace('\\', "/"))).unwrap_or_default();
        let binary = [&base, &ours, &theirs]
            .iter()
            .any(|s| s.as_deref().is_some_and(|b| !is_text(b)))
            || !is_text(&merged_bytes);
        let text = |b: Option<Vec<u8>>| {
            if binary {
                None
            } else {
                b.and_then(|b| String::from_utf8(b).ok())
            }
        };
        let (ours_label, theirs_label) = side_labels(repo);
        Ok(ConflictFile {
            path: path.replace('\\', "/"),
            binary,
            base: text(base),
            ours: text(ours),
            theirs: text(theirs),
            merged: if binary {
                String::new()
            } else {
                String::from_utf8(merged_bytes).unwrap_or_default()
            },
            ours_label,
            theirs_label,
        })
    }

    fn conflict_resolve(
        &self,
        repo: &Repository,
        path: &str,
        resolution: &ConflictResolution,
    ) -> AppResult<()> {
        let c = find_conflict(repo, path)?;
        let dir = workdir(repo)?;
        let rel = path.replace('\\', "/");
        let full = dir.join(&rel);
        let cli = GitCli::new();
        // `Some(bytes)` writes and stages the file; `None` stages a deletion.
        let content: Option<Vec<u8>> = match resolution {
            ConflictResolution::Ours => blob_bytes(repo, &c.our)?,
            ConflictResolution::Theirs => blob_bytes(repo, &c.their)?,
            ConflictResolution::Content { content } => Some(content.clone().into_bytes()),
        };
        match content {
            Some(bytes) => {
                if let Some(parent) = full.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&full, bytes)?;
                cli.run(dir, &["add", "--", rel.as_str()])?;
            }
            None => {
                cli.run(dir, &["rm", "--quiet", "-f", "--", rel.as_str()])?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
