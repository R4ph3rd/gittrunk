//! `oplog` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn oplog_list(repo: RepoId, limit: u32) -> AppResult<Vec<OplogEntry>> {
    Err(AppError::not_implemented("oplog_list"))
}

#[tauri::command]
#[specta::specta]
pub async fn undo(repo: RepoId, dry_run: bool) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("undo"))
}

#[tauri::command]
#[specta::specta]
pub async fn redo(repo: RepoId, dry_run: bool) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("redo"))
}

#[tauri::command]
#[specta::specta]
pub async fn op_cancel(op_id: OpId) -> AppResult<()> {
    Err(AppError::not_implemented("op_cancel"))
}
