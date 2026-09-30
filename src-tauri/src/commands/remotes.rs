//! `remotes` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn remote_list(repo: RepoId) -> AppResult<Vec<RemoteInfo>> {
    Err(AppError::not_implemented("remote_list"))
}

#[tauri::command]
#[specta::specta]
pub async fn remote_add(repo: RepoId, request: RemoteAddRequest) -> AppResult<RemoteInfo> {
    Err(AppError::not_implemented("remote_add"))
}

#[tauri::command]
#[specta::specta]
pub async fn remote_remove(repo: RepoId, name: String) -> AppResult<()> {
    Err(AppError::not_implemented("remote_remove"))
}

#[tauri::command]
#[specta::specta]
pub async fn remote_rename(repo: RepoId, old_name: String, new_name: String) -> AppResult<()> {
    Err(AppError::not_implemented("remote_rename"))
}

#[tauri::command]
#[specta::specta]
pub async fn remote_set_url(repo: RepoId, name: String, url: String, push: bool) -> AppResult<()> {
    Err(AppError::not_implemented("remote_set_url"))
}

#[tauri::command]
#[specta::specta]
pub async fn fetch(repo: RepoId, request: FetchRequest) -> AppResult<OpId> {
    Err(AppError::not_implemented("fetch"))
}

#[tauri::command]
#[specta::specta]
pub async fn pull(repo: RepoId, request: PullRequest) -> AppResult<OpId> {
    Err(AppError::not_implemented("pull"))
}

#[tauri::command]
#[specta::specta]
pub async fn push(repo: RepoId, request: PushRequest) -> AppResult<OpId> {
    Err(AppError::not_implemented("push"))
}

#[tauri::command]
#[specta::specta]
pub async fn set_upstream(repo: RepoId, branch: String, upstream: Option<String>) -> AppResult<()> {
    Err(AppError::not_implemented("set_upstream"))
}

#[tauri::command]
#[specta::specta]
pub async fn credential_respond(
    request_id: String,
    value: Option<String>,
    remember: bool,
) -> AppResult<()> {
    Err(AppError::not_implemented("credential_respond"))
}

#[tauri::command]
#[specta::specta]
pub async fn credential_store(request: CredentialStoreRequest) -> AppResult<()> {
    Err(AppError::not_implemented("credential_store"))
}

#[tauri::command]
#[specta::specta]
pub async fn credential_clear(host: String) -> AppResult<()> {
    Err(AppError::not_implemented("credential_clear"))
}
