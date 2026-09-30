//! Remote management (list, add, remove, rename, set URL, set upstream)
//! through libgit2. Kept in its own trait so `GitService` stays untouched.

use git2::{BranchType, Repository};

use super::{provider, validate};
use crate::git::libgit::LibGit;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::{RemoteAddRequest, RemoteInfo};

pub trait RemoteService: Send + Sync {
    fn remote_list(&self, repo: &Repository) -> AppResult<Vec<RemoteInfo>>;
    fn remote_add(&self, repo: &Repository, request: &RemoteAddRequest) -> AppResult<RemoteInfo>;
    fn remote_remove(&self, repo: &Repository, name: &str) -> AppResult<()>;
    fn remote_rename(&self, repo: &Repository, old_name: &str, new_name: &str) -> AppResult<()>;
    fn remote_set_url(&self, repo: &Repository, name: &str, url: &str, push: bool)
        -> AppResult<()>;
    /// `upstream` is `remote/branch`; `None` removes the upstream.
    fn set_upstream(
        &self,
        repo: &Repository,
        branch: &str,
        upstream: Option<&str>,
    ) -> AppResult<()>;
}

fn no_remote(name: &str) -> AppError {
    AppError::new(ErrorKind::RefNotFound, format!("no remote named `{name}`"))
}

fn info_of(repo: &Repository, name: &str) -> AppResult<RemoteInfo> {
    let remote = repo.find_remote(name).map_err(|_| no_remote(name))?;
    let fetch_url = remote.url().unwrap_or_default().to_string();
    let push_url = remote.pushurl().ok().flatten().map(str::to_string);
    let provider = provider::detect_provider(&fetch_url);
    Ok(RemoteInfo {
        name: name.to_string(),
        fetch_url,
        push_url,
        provider,
    })
}

impl RemoteService for LibGit {
    fn remote_list(&self, repo: &Repository) -> AppResult<Vec<RemoteInfo>> {
        let names = repo.remotes()?;
        names
            .iter()
            .flatten()
            .flatten()
            .map(|n| info_of(repo, n))
            .collect()
    }

    fn remote_add(&self, repo: &Repository, request: &RemoteAddRequest) -> AppResult<RemoteInfo> {
        validate::remote_name(&request.name)?;
        validate::url(&request.url)?;
        if repo.find_remote(&request.name).is_ok() {
            return Err(AppError::new(
                ErrorKind::InvalidInput,
                format!("remote `{}` already exists", request.name),
            ));
        }
        repo.remote(&request.name, &request.url)?;
        info_of(repo, &request.name)
    }

    fn remote_remove(&self, repo: &Repository, name: &str) -> AppResult<()> {
        validate::remote_name(name)?;
        repo.find_remote(name).map_err(|_| no_remote(name))?;
        repo.remote_delete(name)?;
        Ok(())
    }

    fn remote_rename(&self, repo: &Repository, old_name: &str, new_name: &str) -> AppResult<()> {
        validate::remote_name(old_name)?;
        validate::remote_name(new_name)?;
        repo.find_remote(old_name)
            .map_err(|_| no_remote(old_name))?;
        if repo.find_remote(new_name).is_ok() {
            return Err(AppError::new(
                ErrorKind::InvalidInput,
                format!("remote `{new_name}` already exists"),
            ));
        }
        repo.remote_rename(old_name, new_name)?;
        Ok(())
    }

    fn remote_set_url(
        &self,
        repo: &Repository,
        name: &str,
        url: &str,
        push: bool,
    ) -> AppResult<()> {
        validate::remote_name(name)?;
        validate::url(url)?;
        repo.find_remote(name).map_err(|_| no_remote(name))?;
        if push {
            repo.remote_set_pushurl(name, Some(url))?;
        } else {
            repo.remote_set_url(name, url)?;
        }
        Ok(())
    }

    fn set_upstream(
        &self,
        repo: &Repository,
        branch: &str,
        upstream: Option<&str>,
    ) -> AppResult<()> {
        validate::branch(branch)?;
        let mut b = repo.find_branch(branch, BranchType::Local).map_err(|_| {
            AppError::new(
                ErrorKind::RefNotFound,
                format!("no local branch `{branch}`"),
            )
        })?;
        if let Some(up) = upstream {
            validate::branch(up)?;
            if repo.find_branch(up, BranchType::Remote).is_err() {
                return Err(AppError::new(
                    ErrorKind::RefNotFound,
                    format!("no remote-tracking branch `{up}`"),
                ));
            }
        }
        b.set_upstream(upstream)?;
        Ok(())
    }
}
