//! `avatars` commands.
use std::time::Duration;

use tauri::Manager;

use crate::avatars::{Sources, MAX_SUBJECTS};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

#[tauri::command]
#[specta::specta]
pub async fn avatars_get(
    app: tauri::AppHandle,
    cache: tauri::State<'_, crate::avatars::AvatarCache>,
    subjects: Vec<AvatarSubject>,
    size: u32,
) -> AppResult<Vec<Option<String>>> {
    if subjects.len() > MAX_SUBJECTS {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            format!("at most {MAX_SUBJECTS} avatars per request"),
        ));
    }
    let mode = match app.path().app_config_dir() {
        Ok(dir) => crate::settings::load(&dir).avatars,
        Err(_) => crate::settings::defaults().avatars,
    };
    if mode == AvatarMode::Off {
        return Ok(vec![None; subjects.len()]);
    }
    let dir = app.path().app_cache_dir().ok().map(|d| d.join("avatars"));
    let http = crate::http::client(REQUEST_TIMEOUT)?;
    Ok(cache
        .get_many(
            &http,
            dir.as_deref(),
            mode,
            &Sources::default(),
            &subjects,
            size,
        )
        .await)
}
