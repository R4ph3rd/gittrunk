//! `graph` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn graph_load(repo: RepoId, filter: GraphFilter) -> AppResult<GraphMeta> {
    Err(AppError::not_implemented("graph_load"))
}

#[tauri::command]
#[specta::specta]
pub async fn graph_rows(repo: RepoId, start: u32, len: u32) -> AppResult<Vec<GraphRow>> {
    Err(AppError::not_implemented("graph_rows"))
}

#[tauri::command]
#[specta::specta]
pub async fn graph_search(repo: RepoId, search: GraphSearch) -> AppResult<Vec<u32>> {
    Err(AppError::not_implemented("graph_search"))
}

#[tauri::command]
#[specta::specta]
pub async fn commit_details(repo: RepoId, oid: Oid) -> AppResult<CommitDetails> {
    Err(AppError::not_implemented("commit_details"))
}

#[tauri::command]
#[specta::specta]
pub async fn commit_file_diff(
    repo: RepoId,
    oid: Oid,
    path: String,
    options: DiffOptions,
) -> AppResult<FileDiff> {
    Err(AppError::not_implemented("commit_file_diff"))
}
