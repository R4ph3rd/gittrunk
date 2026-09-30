//! `advanced` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn submodule_list(repo: RepoId) -> AppResult<Vec<SubmoduleInfo>> {
    Err(AppError::not_implemented("submodule_list"))
}

#[tauri::command]
#[specta::specta]
pub async fn submodule_update(repo: RepoId, request: SubmoduleUpdateRequest) -> AppResult<OpId> {
    Err(AppError::not_implemented("submodule_update"))
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_list(repo: RepoId) -> AppResult<Vec<WorktreeInfo>> {
    Err(AppError::not_implemented("worktree_list"))
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_add(repo: RepoId, request: WorktreeAddRequest) -> AppResult<WorktreeInfo> {
    Err(AppError::not_implemented("worktree_add"))
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_remove(repo: RepoId, path: String, force: bool) -> AppResult<()> {
    Err(AppError::not_implemented("worktree_remove"))
}

#[tauri::command]
#[specta::specta]
pub async fn blame(repo: RepoId, path: String, rev: Option<String>) -> AppResult<BlameResult> {
    Err(AppError::not_implemented("blame"))
}

#[tauri::command]
#[specta::specta]
pub async fn file_history(
    repo: RepoId,
    path: String,
    limit: u32,
) -> AppResult<Vec<FileHistoryEntry>> {
    Err(AppError::not_implemented("file_history"))
}

#[tauri::command]
#[specta::specta]
pub async fn reflog(repo: RepoId, ref_name: String, limit: u32) -> AppResult<Vec<ReflogEntry>> {
    Err(AppError::not_implemented("reflog"))
}
