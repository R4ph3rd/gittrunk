//! App-level commands.

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::Manager;

use crate::ipc::error::AppResult;
use crate::ipc::types::{AppInfo, PlatformInfo};
use crate::platform;

/// Version info; also proves the IPC pipeline end to end.
#[tauri::command]
#[specta::specta]
pub async fn app_info() -> AppResult<AppInfo> {
    let git_version = if platform::EMBEDDED {
        let (major, minor, rev) = git2::Version::get().libgit2_version();
        Some(format!("libgit2 {major}.{minor}.{rev} (embedded)"))
    } else {
        Command::new("git")
            .arg("--version")
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
    };
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        git_version,
        platform: std::env::consts::OS.to_string(),
    })
}

/// Platform capability facts. Pure core so it is testable without Tauri.
/// `data_dir` is the app data directory; it seeds `default_repos_dir` on
/// mobile/embedded builds (created if missing).
pub fn platform_info_for(data_dir: Option<&Path>) -> PlatformInfo {
    let default_repos_dir = if platform::MOBILE || platform::EMBEDDED {
        data_dir.and_then(|dir| {
            let repos: PathBuf = dir.join("repos");
            std::fs::create_dir_all(&repos).ok()?;
            Some(repos.to_string_lossy().into_owned())
        })
    } else {
        None
    };
    PlatformInfo {
        os: std::env::consts::OS.to_string(),
        mobile: platform::MOBILE,
        has_git_cli: !platform::EMBEDDED,
        can_pick_folder: !platform::MOBILE,
        supports_ssh: !platform::EMBEDDED,
        supports_external_editor: !platform::MOBILE,
        supports_rebase: platform::SUPPORTS_REBASE,
        supports_interactive_rebase: !platform::EMBEDDED,
        supports_worktrees: platform::SUPPORTS_WORKTREES,
        supports_submodules: !platform::EMBEDDED,
        supports_file_history: platform::SUPPORTS_FILE_HISTORY,
        supports_hooks: !platform::EMBEDDED,
        read_only: platform::READ_ONLY,
        supports_terminal: platform::SUPPORTS_TERMINAL,
        secret_store: if platform::EMBEDDED {
            "file"
        } else {
            "keychain"
        }
        .to_string(),
        default_repos_dir,
    }
}

/// Default directory for repositories on mobile/embedded builds.
pub fn default_repos_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    platform_info_for(Some(&dir))
        .default_repos_dir
        .map(PathBuf::from)
}

#[tauri::command]
#[specta::specta]
pub async fn platform_info(app: tauri::AppHandle) -> AppResult<PlatformInfo> {
    let dir = app.path().app_data_dir().ok();
    Ok(platform_info_for(dir.as_deref()))
}

/// Lets the Android back handler close the app ("press back again to exit").
#[tauri::command]
#[specta::specta]
pub async fn app_exit(app: tauri::AppHandle) -> AppResult<()> {
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(any(embedded_git, mobile)))]
    #[test]
    fn desktop_capabilities() {
        let dir = tempfile::tempdir().unwrap();
        let info = platform_info_for(Some(dir.path()));
        assert!(info.has_git_cli && info.supports_ssh && info.can_pick_folder);
        assert!(info.supports_rebase && info.supports_worktrees && info.supports_hooks);
        assert!(!info.read_only && info.supports_terminal);
        assert_eq!(info.secret_store, "keychain");
        assert_eq!(info.default_repos_dir, None);
        assert!(!dir.path().join("repos").exists());
    }

    #[cfg(embedded_git)]
    #[test]
    fn embedded_capabilities() {
        let dir = tempfile::tempdir().unwrap();
        let info = platform_info_for(Some(dir.path()));
        assert!(!info.has_git_cli && !info.supports_ssh && !info.supports_hooks);
        assert!(!info.supports_interactive_rebase && !info.supports_submodules);
        assert_eq!(info.read_only, platform::MOBILE);
        assert_eq!(info.supports_terminal, cfg!(not(target_os = "android")));
        assert_eq!(info.secret_store, "file");
        let repos = info.default_repos_dir.expect("repos dir");
        assert!(Path::new(&repos).is_dir());
        assert_eq!(platform_info_for(None).default_repos_dir, None);
    }
}
