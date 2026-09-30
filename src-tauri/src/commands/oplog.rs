//! `oplog` commands: journal listing, undo, redo and cancellation.
use crate::git::oplog::Oplog;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn oplog_list(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    limit: u32,
) -> AppResult<Vec<OplogEntry>> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.with_repo(&repo, |_, r| Oplog::list(r, limit as usize))).await
}

#[tauri::command]
#[specta::specta]
pub async fn undo(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.write_repo(&repo, |r| Oplog::undo(r, dry_run))).await
}

#[tauri::command]
#[specta::specta]
pub async fn redo(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.write_repo(&repo, |r| Oplog::redo(r, dry_run))).await
}

#[tauri::command]
#[specta::specta]
pub async fn op_cancel(
    state: tauri::State<'_, crate::git::GitState>,
    op_id: OpId,
) -> AppResult<()> {
    // Cancelling an operation that already finished is not an error.
    state.ops().cancel(&op_id);
    Ok(())
}
