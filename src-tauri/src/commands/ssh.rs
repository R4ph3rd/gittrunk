//! `ssh` commands: key listing and generation. Desktop only; on Android they
//! return `Unsupported` (the `ssh-key` crate is not built there).

use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[cfg(not(target_os = "android"))]
fn ssh_dir_of(app: &tauri::AppHandle) -> AppResult<std::path::PathBuf> {
    use crate::ipc::error::ErrorKind;
    use tauri::Manager;
    let home = app
        .path()
        .home_dir()
        .map_err(|_| AppError::new(ErrorKind::Io, "No home directory"))?;
    Ok(crate::ssh::ssh_dir(&home))
}

#[cfg(target_os = "android")]
fn unsupported() -> AppError {
    AppError::new(
        crate::ipc::error::ErrorKind::Unsupported,
        "SSH keys are not available on this device",
    )
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_keys_list(app: tauri::AppHandle) -> AppResult<SshKeyList> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Err(unsupported())
    }
    #[cfg(not(target_os = "android"))]
    {
        let dir = ssh_dir_of(&app)?;
        crate::git::blocking(move || {
            let keys = crate::ssh::list(&dir)?;
            Ok(SshKeyList {
                dir: dir.to_string_lossy().into_owned(),
                keys,
            })
        })
        .await
    }
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_key_generate(
    app: tauri::AppHandle,
    request: SshKeyGenerateRequest,
) -> AppResult<SshKey> {
    #[cfg(target_os = "android")]
    {
        let _ = (app, request);
        Err(unsupported())
    }
    #[cfg(not(target_os = "android"))]
    {
        let dir = ssh_dir_of(&app)?;
        crate::git::blocking(move || crate::ssh::generate(&dir, &request)).await
    }
}
