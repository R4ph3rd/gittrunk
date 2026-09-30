//! `history` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn merge(repo: RepoId, request: MergeRequest, dry_run: bool) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("merge"))
}

#[tauri::command]
#[specta::specta]
pub async fn rebase(repo: RepoId, request: RebaseRequest, dry_run: bool) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("rebase"))
}

#[tauri::command]
#[specta::specta]
pub async fn rebase_todo_load(repo: RepoId, base: Oid) -> AppResult<Vec<RebaseTodoItem>> {
    Err(AppError::not_implemented("rebase_todo_load"))
}

#[tauri::command]
#[specta::specta]
pub async fn rebase_interactive(
    repo: RepoId,
    request: InteractiveRebaseRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("rebase_interactive"))
}

#[tauri::command]
#[specta::specta]
pub async fn cherry_pick(
    repo: RepoId,
    request: CherryPickRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("cherry_pick"))
}

#[tauri::command]
#[specta::specta]
pub async fn revert(repo: RepoId, request: RevertRequest, dry_run: bool) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("revert"))
}

#[tauri::command]
#[specta::specta]
pub async fn reset(repo: RepoId, request: ResetRequest, dry_run: bool) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("reset"))
}

#[tauri::command]
#[specta::specta]
pub async fn sequencer_control(repo: RepoId, action: SequencerAction) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("sequencer_control"))
}
