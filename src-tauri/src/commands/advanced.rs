//! `advanced` commands: submodules, worktrees, blame, file history, reflog.

use git2::Repository;

use crate::git::advanced::{self, AdvancedService};
use crate::git::libgit::LibGit;
use crate::git::remote::{net, ops};
use crate::git::GitState;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

/// Working directory for CLI calls of an open repository.
fn cli_dir(state: &GitState, repo: &str) -> AppResult<std::path::PathBuf> {
    state.with_repo(repo, |_, r| Ok(net::run_dir(r)))
}

#[tauri::command]
#[specta::specta]
pub async fn submodule_list(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
) -> AppResult<Vec<SubmoduleInfo>> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.with_repo(&repo, |_, r| LibGit.submodule_list(r))).await
}

#[tauri::command]
#[specta::specta]
pub async fn submodule_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: SubmoduleUpdateRequest,
) -> AppResult<OpId> {
    let args = advanced::submodule::update_args(&request)?;
    let entry = state.entry(&repo)?;
    let git_dir = entry.git_dir.clone();
    Ok(ops::spawn_op(
        app,
        state.inner(),
        Some(entry),
        move |sess| {
            let dir = net::run_dir(&Repository::open(&git_dir)?);
            sess.run_ok(&dir, &args)?;
            Ok(None)
        },
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_list(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
) -> AppResult<Vec<WorktreeInfo>> {
    let st = state.inner().clone();
    crate::git::blocking(move || {
        let dir = cli_dir(&st, &repo)?;
        advanced::worktree::list(&st.cli(), &dir)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_add(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: WorktreeAddRequest,
) -> AppResult<WorktreeInfo> {
    let st = state.inner().clone();
    crate::git::blocking(move || {
        let dir = cli_dir(&st, &repo)?;
        advanced::worktree::add(&st.cli(), &dir, &request)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_remove(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    path: String,
    force: bool,
) -> AppResult<()> {
    let st = state.inner().clone();
    crate::git::blocking(move || {
        let dir = cli_dir(&st, &repo)?;
        advanced::worktree::remove(&st.cli(), &dir, &path, force)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn blame(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    path: String,
    rev: Option<String>,
) -> AppResult<BlameResult> {
    let st = state.inner().clone();
    crate::git::blocking(move || {
        // Own handle: a long blame must not block other reads.
        let entry = st.entry(&repo)?;
        let r = Repository::open(&entry.git_dir)?;
        LibGit.blame(&r, &path, rev.as_deref())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn file_history(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    path: String,
    limit: u32,
) -> AppResult<Vec<FileHistoryEntry>> {
    let st = state.inner().clone();
    crate::git::blocking(move || {
        let dir = cli_dir(&st, &repo)?;
        advanced::history::file_history(&st.cli(), &dir, &path, limit)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn reflog(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    ref_name: String,
    limit: u32,
) -> AppResult<Vec<ReflogEntry>> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.with_repo(&repo, |_, r| LibGit.reflog(r, &ref_name, limit)))
        .await
}
