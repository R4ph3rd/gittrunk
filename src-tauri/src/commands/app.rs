//! App-level commands.

use std::process::Command;

use crate::ipc::error::AppResult;
use crate::ipc::types::AppInfo;

/// Version info; also proves the IPC pipeline end to end.
#[tauri::command]
#[specta::specta]
pub async fn app_info() -> AppResult<AppInfo> {
    let git_version = Command::new("git")
        .arg("--version")
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string());
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        git_version,
        platform: std::env::consts::OS.to_string(),
    })
}
