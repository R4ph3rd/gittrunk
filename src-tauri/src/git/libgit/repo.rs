//! Repository-level info: head, state, init.

use std::path::Path;

use git2::{Repository, RepositoryInitOptions, RepositoryState};

use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub fn init(request: &InitRequest) -> AppResult<Repository> {
    let mut opts = RepositoryInitOptions::new();
    opts.bare(request.bare).mkpath(true);
    if let Some(branch) = request.initial_branch.as_deref().filter(|b| !b.is_empty()) {
        opts.initial_head(branch);
    }
    Ok(Repository::init_opts(Path::new(&request.path), &opts)?)
}

pub fn head_state(repo: &Repository) -> AppResult<HeadState> {
    match repo.head() {
        Ok(head) => {
            let oid = head.peel_to_commit()?.id().to_string();
            if repo.head_detached().unwrap_or(false) {
                Ok(HeadState::Detached { oid })
            } else {
                Ok(HeadState::Branch {
                    name: head.shorthand().unwrap_or_default().to_string(),
                    oid,
                })
            }
        }
        Err(e)
            if e.code() == git2::ErrorCode::UnbornBranch
                || e.code() == git2::ErrorCode::NotFound =>
        {
            let head_ref = repo.find_reference("HEAD")?;
            let name = head_ref
                .symbolic_target()
                .ok()
                .flatten()
                .map(|t| t.strip_prefix("refs/heads/").unwrap_or(t))
                .unwrap_or("HEAD")
                .to_string();
            Ok(HeadState::Unborn { name })
        }
        Err(e) => Err(e.into()),
    }
}

pub fn repo_state(repo: &Repository) -> RepoState {
    match repo.state() {
        RepositoryState::Clean => RepoState::Clean,
        RepositoryState::Merge => RepoState::Merge,
        RepositoryState::Revert | RepositoryState::RevertSequence => RepoState::Revert,
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => RepoState::CherryPick,
        RepositoryState::Bisect => RepoState::Bisect,
        RepositoryState::Rebase | RepositoryState::RebaseMerge => RepoState::Rebase,
        RepositoryState::RebaseInteractive => RepoState::RebaseInteractive,
        RepositoryState::ApplyMailbox | RepositoryState::ApplyMailboxOrRebase => {
            RepoState::ApplyMailbox
        }
    }
}

pub fn info(repo: &Repository, id: &str) -> AppResult<RepoInfo> {
    let root = repo.workdir().unwrap_or_else(|| repo.path());
    let path = root
        .to_string_lossy()
        .trim_end_matches(['/', '\\'])
        .to_string();
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty() && n != ".git")
        .or_else(|| {
            root.parent()
                .and_then(Path::file_name)
                .map(|n| n.to_string_lossy().into_owned())
        })
        .ok_or_else(|| AppError::new(ErrorKind::Internal, "repository has no name"))?;
    Ok(RepoInfo {
        id: id.to_string(),
        path,
        name,
        head: head_state(repo)?,
        state: repo_state(repo),
        is_bare: repo.is_bare(),
    })
}
