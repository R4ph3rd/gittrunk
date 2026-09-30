//! `settings` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn settings_get() -> AppResult<AppSettings> {
    Err(AppError::not_implemented("settings_get"))
}

#[tauri::command]
#[specta::specta]
pub async fn settings_set(settings: AppSettings) -> AppResult<AppSettings> {
    Err(AppError::not_implemented("settings_set"))
}

#[tauri::command]
#[specta::specta]
pub async fn keybindings_get() -> AppResult<Vec<Keybinding>> {
    Err(AppError::not_implemented("keybindings_get"))
}

#[tauri::command]
#[specta::specta]
pub async fn keybindings_set(bindings: Vec<Keybinding>) -> AppResult<Vec<Keybinding>> {
    Err(AppError::not_implemented("keybindings_set"))
}
