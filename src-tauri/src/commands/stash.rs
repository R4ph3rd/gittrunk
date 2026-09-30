//! `stash` commands: listing plus save, apply/pop and drop.

use crate::git::libgit::LibGit;
use crate::git::stash_write::StashWriteService;
use crate::git::GitState;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

macro_rules! stash_write {
    ($state:expr, $repo:expr, |$r:ident| $body:expr) => {{
        let st = $state.inner().clone();
        crate::git::blocking(move || st.write_repo(&$repo, |$r| $body)).await
    }};
}

#[tauri::command]
#[specta::specta]
pub async fn stash_list(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
) -> AppResult<Vec<StashEntry>> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.with_repo(&repo, |svc, r| svc.stash_list(r))).await
}

#[tauri::command]
#[specta::specta]
pub async fn stash_save(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: StashSaveRequest,
) -> AppResult<OpOutcome> {
    let cli = state.cli().clone();
    stash_write!(state, repo, |r| LibGit.stash_save(r, &cli, &request))
}

#[tauri::command]
#[specta::specta]
pub async fn stash_apply(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    index: u32,
    pop: bool,
) -> AppResult<OpOutcome> {
    let cli = state.cli().clone();
    stash_write!(state, repo, |r| LibGit.stash_apply(r, &cli, index, pop))
}

#[tauri::command]
#[specta::specta]
pub async fn stash_drop(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    index: u32,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    let cli = state.cli().clone();
    stash_write!(state, repo, |r| LibGit.stash_drop(r, &cli, index, dry_run))
}
