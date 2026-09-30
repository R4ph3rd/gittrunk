//! The `GitService` trait: every git operation the commands need. The libgit2
//! implementation lives in `git/libgit/`; CLI-backed operations are added later.

use std::path::Path;

use git2::Repository;

use crate::git::graph::GraphCache;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

pub trait GitService: Send + Sync {
    /// Opens the repository containing `path` (any path inside a worktree).
    fn open(&self, path: &Path) -> AppResult<Repository>;
    fn init(&self, request: &InitRequest) -> AppResult<Repository>;
    fn repo_info(&self, repo: &Repository, id: &str) -> AppResult<RepoInfo>;

    /// Walks history and computes the lane layout.
    fn graph_build(&self, repo: &Repository, filter: &GraphFilter) -> AppResult<GraphCache>;
    fn commit_details(&self, repo: &Repository, oid: &str) -> AppResult<CommitDetails>;
    fn commit_file_diff(
        &self,
        repo: &Repository,
        oid: &str,
        path: &str,
        options: &DiffOptions,
    ) -> AppResult<FileDiff>;

    fn status(&self, repo: &Repository) -> AppResult<StatusSnapshot>;
    fn worktree_file_diff(
        &self,
        repo: &Repository,
        path: &str,
        staged: bool,
        options: &DiffOptions,
    ) -> AppResult<FileDiff>;

    fn refs_list(&self, repo: &mut Repository) -> AppResult<RefsSnapshot>;
    fn stash_list(&self, repo: &mut Repository) -> AppResult<Vec<StashEntry>>;
}
