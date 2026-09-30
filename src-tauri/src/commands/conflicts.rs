//! `conflicts` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn conflict_list(repo: RepoId) -> AppResult<Vec<FileChange>> {
    Err(AppError::not_implemented("conflict_list"))
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_file(repo: RepoId, path: String) -> AppResult<ConflictFile> {
    Err(AppError::not_implemented("conflict_file"))
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_resolve(
    repo: RepoId,
    path: String,
    resolution: ConflictResolution,
) -> AppResult<()> {
    Err(AppError::not_implemented("conflict_resolve"))
}
