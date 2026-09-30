//! `avatars` commands. Stub until M9 Wave 1.
use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn avatars_get(
    app: tauri::AppHandle,
    cache: tauri::State<'_, crate::avatars::AvatarCache>,
    subjects: Vec<AvatarSubject>,
    size: u32,
) -> AppResult<Vec<Option<String>>> {
    let _ = (&app, &cache, &subjects, &size);
    Err(AppError::not_implemented("avatars_get"))
}
