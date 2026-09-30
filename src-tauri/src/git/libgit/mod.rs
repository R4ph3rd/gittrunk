//! libgit2 implementation of `GitService`.

pub mod diff;
pub mod refs;
pub mod repo;

#[cfg(test)]
mod tests;

use std::path::Path;

use git2::Repository;

use crate::git::graph::{self, GraphCache};
use crate::git::service::GitService;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

#[derive(Debug, Default, Clone, Copy)]
pub struct LibGit;

pub(crate) fn parse_oid(s: &str) -> AppResult<git2::Oid> {
    git2::Oid::from_str(s)
        .map_err(|_| AppError::new(ErrorKind::InvalidInput, format!("invalid object id `{s}`")))
}

pub(crate) fn signature(sig: &git2::Signature<'_>) -> Signature {
    Signature {
        name: String::from_utf8_lossy(sig.name_bytes()).into_owned(),
        email: String::from_utf8_lossy(sig.email_bytes()).into_owned(),
        time: sig.when().seconds() as f64,
        offset_minutes: sig.when().offset_minutes(),
    }
}

impl GitService for LibGit {
    fn open(&self, path: &Path) -> AppResult<Repository> {
        Ok(Repository::discover(path)?)
    }

    fn init(&self, request: &InitRequest) -> AppResult<Repository> {
        repo::init(request)
    }

    fn repo_info(&self, repo: &Repository, id: &str) -> AppResult<RepoInfo> {
        repo::info(repo, id)
    }

    fn graph_build(&self, repo: &Repository, filter: &GraphFilter) -> AppResult<GraphCache> {
        graph::build::build(repo, filter)
    }

    fn commit_details(&self, repo: &Repository, oid: &str) -> AppResult<CommitDetails> {
        diff::commit_details(repo, oid)
    }

    fn commit_file_diff(
        &self,
        repo: &Repository,
        oid: &str,
        path: &str,
        options: &DiffOptions,
    ) -> AppResult<FileDiff> {
        diff::commit_file_diff(repo, oid, path, options)
    }

    fn status(&self, repo: &Repository) -> AppResult<StatusSnapshot> {
        diff::status(repo)
    }

    fn worktree_file_diff(
        &self,
        repo: &Repository,
        path: &str,
        staged: bool,
        options: &DiffOptions,
    ) -> AppResult<FileDiff> {
        diff::worktree_file_diff(repo, path, staged, options)
    }

    fn refs_list(&self, repo: &mut Repository) -> AppResult<RefsSnapshot> {
        refs::refs_list(repo)
    }

    fn stash_list(&self, repo: &mut Repository) -> AppResult<Vec<StashEntry>> {
        refs::stash_list(repo)
    }
}
