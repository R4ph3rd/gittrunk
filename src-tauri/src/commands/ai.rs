//! `ai` commands. Thin wrappers over `crate::ai`: every content-bearing
//! command checks `AiSettings.enabled` first, and keys never leave the OS
//! keychain.

use std::path::PathBuf;

use tauri::Manager;

use crate::ai::settings::{self, SystemKeys};
use crate::ai::{plan, service};
use crate::git::remote::ops;
use crate::git::{blocking, GitState};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

fn config_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    app.path().app_config_dir().map_err(|e| {
        AppError::new(
            ErrorKind::Io,
            format!("cannot locate the app config directory: {e}"),
        )
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ai_settings_get(app: tauri::AppHandle) -> AppResult<AiSettings> {
    let dir = config_dir(&app)?;
    blocking(move || Ok(settings::load(&dir, &SystemKeys))).await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_settings_set(app: tauri::AppHandle, settings: AiSettings) -> AppResult<AiSettings> {
    let dir = config_dir(&app)?;
    blocking(move || settings::save(&dir, &SystemKeys, &settings)).await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_key_set(provider: AiProviderKind, key: String) -> AppResult<()> {
    blocking(move || settings::set_key(&SystemKeys, provider, &key)).await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_key_clear(provider: AiProviderKind) -> AppResult<()> {
    use settings::KeyStore;
    blocking(move || SystemKeys.clear(provider)).await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_payload_preview(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: AiRequest,
) -> AppResult<AiPayloadPreview> {
    let dir = config_dir(&app)?;
    service::payload_preview(state.inner(), &dir, &SystemKeys, &repo, &request).await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: AiRequest,
) -> AppResult<AiResponse> {
    let dir = config_dir(&app)?;
    service::run(state.inner(), &dir, &SystemKeys, &repo, &request).await
}

// Runs a confirmed plan. Fetch/pull/push steps run synchronously through the
// same credential bridge as the toolbar; the command returns when the last
// step has finished.
#[tauri::command]
#[specta::specta]
pub async fn ai_plan_execute(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    plan_id: String,
) -> AppResult<OpOutcome> {
    let dir = config_dir(&app)?;
    let st = state.inner().clone();
    blocking(move || {
        // Even confirmed plans only run while AI is enabled.
        service::enabled_settings(&dir, &SystemKeys)?;
        let session_state = st.clone();
        plan::execute(&st, &repo, &plan_id, &move || {
            ops::sync_session(&app, &session_state, session_state.cli().clone())
        })
    })
    .await
}
