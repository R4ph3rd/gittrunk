//! Git layer: the `GitService` trait with a libgit2 implementation for reads,
//! graph, diffs and simple writes, and a git CLI runner for network operations,
//! sequencer operations, submodules and worktrees.
//!
//! Owned by `rust-git-agent`. Filled in during M1 (see docs/PLAN.md).

pub mod advanced;
pub mod cli;
pub mod conflicts;
pub mod graph;
pub mod history;
pub mod libgit;
pub mod oplog;
pub mod preview;
pub mod recent;
pub mod refs_write;
pub mod remote;
pub mod service;
pub mod staging;
pub mod stash_write;
pub mod watcher;

#[cfg(test)]
pub mod fixtures;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use git2::Repository;
use parking_lot::{Mutex, RwLock};

use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::{CommitOrder, GraphFilter, GraphMeta, RepoId, RepoInfo};

use graph::GraphCache;
use service::GitService;

/// Runs blocking git work off the async runtime.
pub async fn blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::new(ErrorKind::Internal, format!("task failed: {e}")))?
}

/// Filter used when the graph has to be rebuilt without an explicit request.
pub fn default_filter() -> GraphFilter {
    GraphFilter {
        refs: None,
        first_parent: false,
        order: CommitOrder::Topo,
        author: None,
        path: None,
        since: None,
        until: None,
    }
}

/// One open repository: libgit2 handle, cached graph and file watcher.
pub struct RepoEntry {
    pub id: RepoId,
    /// Git directory (`.git`, or the repository itself when bare).
    pub git_dir: PathBuf,
    repo: Mutex<Repository>,
    graph: RwLock<Option<Arc<GraphCache>>>,
    filter: Mutex<GraphFilter>,
    watcher: Mutex<Option<watcher::RepoWatcher>>,
}

impl RepoEntry {
    /// Drops the cached graph; it is rebuilt lazily with the last filter.
    pub fn invalidate_graph(&self) {
        *self.graph.write() = None;
    }
}

/// Backend state managed by Tauri (`State<'_, GitState>` in command handlers).
/// Holds the open-repository registry. Cheap to clone (shared handles), so
/// commands can move a clone into `spawn_blocking`.
#[derive(Clone)]
pub struct GitState {
    repos: Arc<RwLock<HashMap<RepoId, Arc<RepoEntry>>>>,
    next_id: Arc<AtomicU64>,
    service: Arc<dyn GitService>,
    cli: Arc<RwLock<cli::GitCli>>,
    ops: cli::OpRegistry,
    credentials: remote::creds::PendingCredentials,
}

impl Default for GitState {
    fn default() -> Self {
        Self {
            repos: Arc::default(),
            next_id: Arc::new(AtomicU64::new(1)),
            service: Arc::new(libgit::LibGit),
            cli: Arc::new(RwLock::new(cli::GitCli::new())),
            ops: cli::OpRegistry::default(),
            credentials: remote::creds::PendingCredentials::default(),
        }
    }
}

impl GitState {
    pub fn service(&self) -> &dyn GitService {
        &*self.service
    }

    /// The current CLI runner (a cheap copy; it follows `set_git_path`).
    pub fn cli(&self) -> cli::GitCli {
        self.cli.read().clone()
    }

    /// Switches the git executable for all repositories (`None` = `PATH`).
    /// Also updates the default used by `GitCli::new()` call sites.
    pub fn set_git_path(&self, path: Option<PathBuf>) {
        *self.cli.write() = match &path {
            Some(p) => cli::GitCli::with_path(p.clone()),
            None => cli::GitCli::with_path("git"),
        };
        cli::GitCli::set_default_program(path);
    }

    pub fn ops(&self) -> &cli::OpRegistry {
        &self.ops
    }

    /// Credential requests waiting for `credential_respond`.
    pub fn credentials(&self) -> &remote::creds::PendingCredentials {
        &self.credentials
    }

    /// Opens (or re-uses) the repository containing `path`.
    pub fn open(&self, path: &Path) -> AppResult<(Arc<RepoEntry>, RepoInfo)> {
        let repo = self.service.open(path)?;
        self.register(repo)
    }

    /// Initialises a repository and registers it.
    pub fn init(
        &self,
        request: &crate::ipc::types::InitRequest,
    ) -> AppResult<(Arc<RepoEntry>, RepoInfo)> {
        let repo = self.service.init(request)?;
        self.register(repo)
    }

    fn register(&self, repo: Repository) -> AppResult<(Arc<RepoEntry>, RepoInfo)> {
        let git_dir = repo.path().to_path_buf();
        let mut repos = self.repos.write();
        let existing = repos.values().find(|e| same_path(&e.git_dir, &git_dir));
        let entry = if let Some(e) = existing {
            e.clone()
        } else {
            let id = format!("repo-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
            let entry = Arc::new(RepoEntry {
                id: id.clone(),
                git_dir,
                repo: Mutex::new(repo),
                graph: RwLock::new(None),
                filter: Mutex::new(default_filter()),
                watcher: Mutex::new(None),
            });
            repos.insert(id, entry.clone());
            entry
        };
        drop(repos);
        let info = {
            let repo = entry.repo.lock();
            self.service.repo_info(&repo, &entry.id)?
        };
        Ok((entry, info))
    }

    pub fn entry(&self, id: &str) -> AppResult<Arc<RepoEntry>> {
        self.repos.read().get(id).cloned().ok_or_else(|| {
            AppError::new(
                ErrorKind::InvalidInput,
                format!("repository `{id}` is not open"),
            )
        })
    }

    /// Runs `f` with the service and the locked repository handle.
    pub fn with_repo<T>(
        &self,
        id: &str,
        f: impl FnOnce(&dyn GitService, &mut Repository) -> AppResult<T>,
    ) -> AppResult<T> {
        let entry = self.entry(id)?;
        let mut repo = entry.repo.lock();
        f(&*self.service, &mut repo)
    }

    /// Runs a mutating `f` on the locked repository, then drops the cached
    /// graph (the watcher would do it too, but not before the next read).
    pub fn write_repo<T>(
        &self,
        id: &str,
        f: impl FnOnce(&Repository) -> AppResult<T>,
    ) -> AppResult<T> {
        let entry = self.entry(id)?;
        let result = {
            let repo = entry.repo.lock();
            f(&repo)
        };
        entry.invalidate_graph();
        result
    }

    /// Row of `oid` (full id or unique prefix) in the cached graph.
    pub fn graph_find(&self, id: &str, oid: &str) -> AppResult<Option<u32>> {
        let prefix = oid.trim().to_ascii_lowercase();
        if prefix.len() < 4 || prefix.len() > 40 || !prefix.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(AppError::new(
                ErrorKind::InvalidInput,
                format!("`{oid}` is not a valid object id or prefix"),
            ));
        }
        let cache = self.graph(id)?;
        let mut found = None;
        for (i, row) in cache.rows.iter().enumerate() {
            if row.oid.to_string().starts_with(&prefix) {
                if found.is_some() {
                    return Err(AppError::new(
                        ErrorKind::InvalidInput,
                        format!("object id prefix `{oid}` is ambiguous"),
                    ));
                }
                found = Some(i as u32);
            }
        }
        Ok(found)
    }

    /// Closes the repository and stops its watcher.
    pub fn close(&self, id: &str) -> AppResult<()> {
        let entry = self.repos.write().remove(id).ok_or_else(|| {
            AppError::new(
                ErrorKind::InvalidInput,
                format!("repository `{id}` is not open"),
            )
        })?;
        entry.watcher.lock().take();
        Ok(())
    }

    /// Starts the file watcher for `entry` (no-op when already running).
    pub fn ensure_watcher(&self, entry: &Arc<RepoEntry>, app: tauri::AppHandle) {
        let mut slot = entry.watcher.lock();
        if slot.is_some() {
            return;
        }
        let workdir = {
            let repo = entry.repo.lock();
            repo.workdir().map(Path::to_path_buf)
        };
        let weak = Arc::downgrade(entry);
        let id = entry.id.clone();
        let started = watcher::start(workdir.as_deref(), &entry.git_dir, move |scopes| {
            if scopes.contains(&crate::ipc::types::ChangeScope::Refs) {
                if let Some(e) = weak.upgrade() {
                    e.invalidate_graph();
                }
            }
            let payload = crate::ipc::types::RepoChanged {
                repo_id: id.clone(),
                scopes,
            };
            let _ = tauri_specta::Event::emit(&payload, &app);
        });
        if let Ok(w) = started {
            *slot = Some(w);
        }
    }

    /// Builds the graph for `filter`, caches it and returns its metadata.
    pub fn graph_load(&self, id: &str, filter: GraphFilter) -> AppResult<GraphMeta> {
        let entry = self.entry(id)?;
        // A separate handle keeps other reads responsive during the walk.
        let repo = self.service.open(&entry.git_dir)?;
        let cache = Arc::new(self.service.graph_build(&repo, &filter)?);
        let meta = cache.meta();
        *entry.filter.lock() = filter;
        *entry.graph.write() = Some(cache);
        Ok(meta)
    }

    /// The cached graph, rebuilt with the last filter when invalidated.
    pub fn graph(&self, id: &str) -> AppResult<Arc<GraphCache>> {
        let entry = self.entry(id)?;
        let cached = entry.graph.read().clone();
        if let Some(c) = cached {
            return Ok(c);
        }
        let filter = entry.filter.lock().clone();
        let repo = self.service.open(&entry.git_dir)?;
        let cache = Arc::new(self.service.graph_build(&repo, &filter)?);
        *entry.graph.write() = Some(cache.clone());
        Ok(cache)
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

#[cfg(test)]
mod state_tests {
    use super::*;
    use crate::git::refs_write::RefWriteService;
    use crate::ipc::types::{ResetMode, ResetRequest};

    #[test]
    fn graph_find_by_full_id_prefix_and_absent() {
        let (t, oids) = fixtures::linear(3);
        let state = GitState::default();
        let (entry, _) = state.open(&t.root()).unwrap();
        // Lazily builds the graph with the default filter.
        let newest = oids[2].to_string();
        assert_eq!(state.graph_find(&entry.id, &newest).unwrap(), Some(0));
        assert_eq!(
            state.graph_find(&entry.id, &oids[0].to_string()).unwrap(),
            Some(2)
        );
        assert_eq!(
            state
                .graph_find(&entry.id, &oids[1].to_string()[..8].to_uppercase())
                .unwrap(),
            Some(1)
        );
        assert_eq!(state.graph_find(&entry.id, &"0".repeat(40)).unwrap(), None);
        assert_eq!(
            state.graph_find(&entry.id, "zz").unwrap_err().kind,
            ErrorKind::InvalidInput
        );
    }

    #[test]
    fn write_repo_invalidates_the_graph_cache() {
        let (t, _) = fixtures::linear(2);
        let state = GitState::default();
        let (entry, _) = state.open(&t.root()).unwrap();
        let before = state.graph(&entry.id).unwrap();
        state
            .write_repo(&entry.id, |r| {
                libgit::LibGit
                    .reset(
                        r,
                        &ResetRequest {
                            target: "HEAD~1".into(),
                            mode: ResetMode::Soft,
                        },
                        false,
                    )
                    .map(|_| ())
            })
            .unwrap();
        let after = state.graph(&entry.id).unwrap();
        assert!(!Arc::ptr_eq(&before, &after));
        assert_eq!(after.meta().row_count, 1);
    }
}
