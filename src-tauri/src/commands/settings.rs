//! `settings` commands. Storage lives in `crate::settings` (directory based);
//! these bodies resolve the app config dir and apply `git_path`.

use std::path::PathBuf;

use tauri::Manager;

use crate::git::GitState;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;
use crate::settings;

fn config_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| AppError::new(ErrorKind::Io, format!("no config directory: {e}")))
}

#[tauri::command]
#[specta::specta]
pub async fn settings_get(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
) -> AppResult<AppSettings> {
    let dir = config_dir(&app)?;
    let st = state.inner().clone();
    crate::git::blocking(move || {
        let s = settings::load(&dir);
        // A stored path that vanished falls back to PATH without failing.
        st.set_git_path(settings::usable_git_path(&s));
        Ok(s)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn settings_set(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    let dir = config_dir(&app)?;
    let st = state.inner().clone();
    crate::git::blocking(move || {
        let saved = settings::save(&dir, &settings)?;
        st.set_git_path(saved.git_path.as_ref().map(PathBuf::from));
        Ok(saved)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn keybindings_get(app: tauri::AppHandle) -> AppResult<Vec<Keybinding>> {
    let dir = config_dir(&app)?;
    crate::git::blocking(move || Ok(settings::load_keybindings(&dir))).await
}

#[tauri::command]
#[specta::specta]
pub async fn keybindings_set(
    app: tauri::AppHandle,
    bindings: Vec<Keybinding>,
) -> AppResult<Vec<Keybinding>> {
    let dir = config_dir(&app)?;
    crate::git::blocking(move || settings::save_keybindings(&dir, &bindings)).await
}
