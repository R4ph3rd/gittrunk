//! `ssh` commands: key listing and generation (bodies filled by B10).
#![allow(unused_variables)]

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn ssh_keys_list(app: tauri::AppHandle) -> AppResult<SshKeyList> {
    Err(AppError::not_implemented("ssh_keys_list"))
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_key_generate(
    app: tauri::AppHandle,
    request: SshKeyGenerateRequest,
) -> AppResult<SshKey> {
    Err(AppError::not_implemented("ssh_key_generate"))
}
