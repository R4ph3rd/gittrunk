//! `refs` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn refs_list(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
) -> AppResult<RefsSnapshot> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.with_repo(&repo, |svc, r| svc.refs_list(r))).await
}

#[tauri::command]
#[specta::specta]
pub async fn branch_create(repo: RepoId, request: BranchCreateRequest) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("branch_create"))
}

#[tauri::command]
#[specta::specta]
pub async fn branch_delete(
    repo: RepoId,
    request: BranchDeleteRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("branch_delete"))
}

#[tauri::command]
#[specta::specta]
pub async fn branch_rename(
    repo: RepoId,
    old_name: String,
    new_name: String,
) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("branch_rename"))
}

#[tauri::command]
#[specta::specta]
pub async fn checkout(repo: RepoId, target: CheckoutTarget, dry_run: bool) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("checkout"))
}

#[tauri::command]
#[specta::specta]
pub async fn tag_create(repo: RepoId, request: TagCreateRequest) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("tag_create"))
}

#[tauri::command]
#[specta::specta]
pub async fn tag_delete(repo: RepoId, name: String, dry_run: bool) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("tag_delete"))
}

#[tauri::command]
#[specta::specta]
pub async fn ref_move(
    repo: RepoId,
    request: RefMoveRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("ref_move"))
}
