//! `ai` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn ai_settings_get() -> AppResult<AiSettings> {
    Err(AppError::not_implemented("ai_settings_get"))
}

#[tauri::command]
#[specta::specta]
pub async fn ai_settings_set(settings: AiSettings) -> AppResult<AiSettings> {
    Err(AppError::not_implemented("ai_settings_set"))
}

#[tauri::command]
#[specta::specta]
pub async fn ai_key_set(provider: AiProviderKind, key: String) -> AppResult<()> {
    Err(AppError::not_implemented("ai_key_set"))
}

#[tauri::command]
#[specta::specta]
pub async fn ai_key_clear(provider: AiProviderKind) -> AppResult<()> {
    Err(AppError::not_implemented("ai_key_clear"))
}

#[tauri::command]
#[specta::specta]
pub async fn ai_payload_preview(repo: RepoId, request: AiRequest) -> AppResult<AiPayloadPreview> {
    Err(AppError::not_implemented("ai_payload_preview"))
}

#[tauri::command]
#[specta::specta]
pub async fn ai_run(repo: RepoId, request: AiRequest) -> AppResult<AiResponse> {
    Err(AppError::not_implemented("ai_run"))
}

#[tauri::command]
#[specta::specta]
pub async fn ai_plan_execute(repo: RepoId, plan_id: String) -> AppResult<OpOutcome> {
    Err(AppError::not_implemented("ai_plan_execute"))
}
