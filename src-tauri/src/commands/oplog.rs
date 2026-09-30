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

// Undo/redo availability for the toolbar. Stub until M9 Wave 1.
#[tauri::command]
#[specta::specta]
pub async fn oplog_state(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
) -> AppResult<OplogState> {
    let _ = (&state, &repo);
    Err(crate::ipc::error::AppError::not_implemented("oplog_state"))
}

#[cfg(test)]
mod stub_tests {
    use super::*;
    use tauri::Manager;

    #[test]
    fn oplog_state_is_not_implemented() {
        let app = tauri::test::mock_app();
        app.manage(crate::git::GitState::default());
        let err = tauri::async_runtime::block_on(oplog_state(
            app.state::<crate::git::GitState>(),
            "r".to_string(),
        ))
        .unwrap_err();
        assert_eq!(err.kind, crate::ipc::error::ErrorKind::NotImplemented);
    }
}
