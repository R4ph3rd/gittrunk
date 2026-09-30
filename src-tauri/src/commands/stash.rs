//! `stash` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn stash_list(repo: RepoId) -> AppResult<Vec<StashEntry>> {
    Err(AppError::not_implemented("stash_list"))
}

#[tauri::command]
#[specta::specta]
pub async fn stash_save(repo: RepoId, request: StashSaveRequest) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("stash_save"))
}

#[tauri::command]
#[specta::specta]
pub async fn stash_apply(repo: RepoId, index: u32, pop: bool) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("stash_apply"))
}

#[tauri::command]
#[specta::specta]
pub async fn stash_drop(repo: RepoId, index: u32, dry_run: bool) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("stash_drop"))
}
