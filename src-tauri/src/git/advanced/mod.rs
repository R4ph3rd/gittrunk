//! Submodules, worktrees, blame, file history and reflog (M6b).
//!
//! - `submodule` (libgit2 list, CLI update args), `worktree` (CLI),
//!   `blame` (libgit2), `history` (CLI `git log --follow`), `reflog` (libgit2).
//! - `AdvancedService` is a separate trait implemented by `LibGit`, like
//!   `RefWriteService`; CLI-backed operations are free functions taking a
//!   `GitCli`.
//! - Every user value handed to the CLI is validated here and placed after
//!   `--`.

pub mod blame;
pub mod history;
pub mod reflog;
pub mod submodule;
pub mod worktree;

use std::path::{Component, Path};

use git2::Repository;

use crate::git::libgit::LibGit;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub trait AdvancedService: Send + Sync {
    fn submodule_list(&self, repo: &Repository) -> AppResult<Vec<SubmoduleInfo>>;
    fn blame(&self, repo: &Repository, path: &str, rev: Option<&str>) -> AppResult<BlameResult>;
    fn reflog(&self, repo: &Repository, ref_name: &str, limit: u32) -> AppResult<Vec<ReflogEntry>>;
}

impl AdvancedService for LibGit {
    fn submodule_list(&self, repo: &Repository) -> AppResult<Vec<SubmoduleInfo>> {
        submodule::list(repo)
    }

    fn blame(&self, repo: &Repository, path: &str, rev: Option<&str>) -> AppResult<BlameResult> {
        blame::blame(repo, path, rev)
    }

    fn reflog(&self, repo: &Repository, ref_name: &str, limit: u32) -> AppResult<Vec<ReflogEntry>> {
        reflog::reflog(repo, ref_name, limit)
    }
}

pub(crate) fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

/// A repository-relative path (forward or back slashes accepted): non-empty,
/// no NUL, no `..`, not absolute. Returns it with `/` separators. A leading
/// `-` is allowed here because every use sits after `--`.
pub(crate) fn relative_path(path: &str) -> AppResult<String> {
    if path.is_empty() || path.contains('\0') {
        return Err(invalid("path is empty or contains a NUL byte"));
    }
    let unified = path.replace('\\', "/");
    let p = Path::new(&unified);
    if p.is_absolute() || unified.starts_with('/') {
        return Err(invalid(format!("`{path}` must be relative")));
    }
    let mut parts = Vec::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => parts.push(s.to_string_lossy().into_owned()),
            Component::CurDir => {}
            _ => return Err(invalid(format!("`{path}` is not a plain relative path"))),
        }
    }
    if parts.is_empty() {
        return Err(invalid("path is empty"));
    }
    Ok(parts.join("/"))
}

pub(crate) fn clamp_limit(limit: u32) -> AppResult<usize> {
    if limit == 0 {
        return Err(invalid("limit must be at least 1"));
    }
    Ok(limit.min(10_000) as usize)
}

#[cfg(test)]
mod tests;
