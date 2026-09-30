//! `history` commands: merge, rebase, cherry-pick, revert, reset and the
//! sequencer controls.

use crate::git::history::HistoryService;
use crate::git::libgit::LibGit;
use crate::git::GitState;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

macro_rules! history {
    ($state:expr, $repo:expr, |$r:ident| $body:expr) => {{
        let st = $state.inner().clone();
        crate::git::blocking(move || st.write_repo(&$repo, |$r| $body)).await
    }};
}

#[tauri::command]
#[specta::specta]
pub async fn merge(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: MergeRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    history!(state, repo, |r| LibGit.merge(r, &request, dry_run))
}

#[tauri::command]
#[specta::specta]
pub async fn rebase(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: RebaseRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    history!(state, repo, |r| LibGit.rebase(r, &request, dry_run))
}

#[tauri::command]
#[specta::specta]
pub async fn rebase_todo_load(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    base: Oid,
) -> AppResult<Vec<RebaseTodoItem>> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.with_repo(&repo, |_, r| LibGit.rebase_todo_load(r, &base)))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn rebase_interactive(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: InteractiveRebaseRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    history!(state, repo, |r| LibGit
        .rebase_interactive(r, &request, dry_run))
}

#[tauri::command]
#[specta::specta]
pub async fn cherry_pick(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: CherryPickRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    history!(state, repo, |r| LibGit.cherry_pick(r, &request, dry_run))
}

#[tauri::command]
#[specta::specta]
pub async fn revert(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: RevertRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    history!(state, repo, |r| LibGit.revert(r, &request, dry_run))
}

#[tauri::command]
#[specta::specta]
pub async fn reset(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    request: ResetRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    use crate::git::refs_write::RefWriteService;
    let st = state.inner().clone();
    crate::git::blocking(move || {
        st.write_repo(&repo, |r| {
            crate::git::libgit::LibGit.reset(r, &request, dry_run)
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sequencer_control(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    action: SequencerAction,
) -> AppResult<OpOutcome> {
    history!(state, repo, |r| LibGit.sequencer_control(r, action))
}
