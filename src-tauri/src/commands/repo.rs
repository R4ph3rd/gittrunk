//! `repo` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn repo_open(path: String) -> AppResult<RepoInfo> {
    Err(AppError::not_implemented("repo_open"))
}

#[tauri::command]
#[specta::specta]
pub async fn repo_init(request: InitRequest) -> AppResult<RepoInfo> {
    Err(AppError::not_implemented("repo_init"))
}

#[tauri::command]
#[specta::specta]
pub async fn repo_clone(request: CloneRequest) -> AppResult<OpId> {
    Err(AppError::not_implemented("repo_clone"))
}

#[tauri::command]
#[specta::specta]
pub async fn repo_close(repo: RepoId) -> AppResult<()> {
    Err(AppError::not_implemented("repo_close"))
}

#[tauri::command]
#[specta::specta]
pub async fn repo_info(repo: RepoId) -> AppResult<RepoInfo> {
    Err(AppError::not_implemented("repo_info"))
}

#[tauri::command]
#[specta::specta]
pub async fn repo_recent() -> AppResult<Vec<RecentRepo>> {
    Err(AppError::not_implemented("repo_recent"))
}
