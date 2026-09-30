//! `worktree` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn status(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
) -> AppResult<StatusSnapshot> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.with_repo(&repo, |svc, r| svc.status(r))).await
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_file_diff(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    path: String,
    staged: bool,
    options: DiffOptions,
) -> AppResult<FileDiff> {
    let st = state.inner().clone();
    crate::git::blocking(move || {
        st.with_repo(&repo, |svc, r| {
            svc.worktree_file_diff(r, &path, staged, &options)
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn stage_paths(repo: RepoId, paths: Vec<String>) -> AppResult<()> {
    Err(AppError::not_implemented("stage_paths"))
}

#[tauri::command]
#[specta::specta]
pub async fn unstage_paths(repo: RepoId, paths: Vec<String>) -> AppResult<()> {
    Err(AppError::not_implemented("unstage_paths"))
}

#[tauri::command]
#[specta::specta]
pub async fn discard_paths(
    repo: RepoId,
    paths: Vec<String>,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("discard_paths"))
}

#[tauri::command]
#[specta::specta]
pub async fn stage_lines(repo: RepoId, selection: LineSelection) -> AppResult<()> {
    Err(AppError::not_implemented("stage_lines"))
}

#[tauri::command]
#[specta::specta]
pub async fn unstage_lines(repo: RepoId, selection: LineSelection) -> AppResult<()> {
    Err(AppError::not_implemented("unstage_lines"))
}

#[tauri::command]
#[specta::specta]
pub async fn discard_lines(
    repo: RepoId,
    selection: LineSelection,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("discard_lines"))
}

#[tauri::command]
#[specta::specta]
pub async fn commit_create(repo: RepoId, request: CommitRequest) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("commit_create"))
}
