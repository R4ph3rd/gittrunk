//! Git identity (`user.name` / `user.email`) in the global config.

use std::path::{Path, PathBuf};

use crate::git::blocking;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::GitIdentity;

/// Reads identity from the default config chain (system, global, XDG).
pub fn read_default() -> AppResult<GitIdentity> {
    let cfg = git2::Config::open_default()?;
    Ok(GitIdentity {
        name: cfg.get_string("user.name").ok(),
        email: cfg.get_string("user.email").ok(),
    })
}

/// Trims and validates one identity field.
fn clean(field: &str, value: &str) -> AppResult<String> {
    let v = value.trim();
    if v.is_empty() || v.contains(['\n', '\r', '<', '>']) {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            format!(
                "invalid {field}: must be non-empty and free of line breaks and angle brackets"
            ),
        ));
    }
    Ok(v.to_string())
}

/// Validates and writes identity into the config file at `file`.
pub fn write_identity_at(file: &Path, name: &str, email: &str) -> AppResult<GitIdentity> {
    let name = clean("name", name)?;
    let email = clean("email", email)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut cfg = git2::Config::open(file)?;
    cfg.set_str("user.name", &name)?;
    cfg.set_str("user.email", &email)?;
    Ok(GitIdentity {
        name: Some(name),
        email: Some(email),
    })
}

/// Existing global config file, or a new `.gitconfig` in the global search dir.
fn global_config_path() -> AppResult<PathBuf> {
    if let Ok(existing) = git2::Config::find_global() {
        return Ok(existing);
    }
    // SAFETY: plain libgit2 option read, no pointers retained.
    let raw = unsafe { git2::opts::get_search_path(git2::ConfigLevel::Global) }?;
    let raw = raw.to_string_lossy().into_owned();
    let dir = std::env::split_paths(&raw)
        .find(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| AppError::new(ErrorKind::Internal, "no global git config directory"))?;
    Ok(dir.join(".gitconfig"))
}

#[tauri::command]
#[specta::specta]
pub async fn git_identity_get() -> AppResult<GitIdentity> {
    blocking(read_default).await
}

#[tauri::command]
#[specta::specta]
pub async fn git_identity_set(name: String, email: String) -> AppResult<GitIdentity> {
    blocking(move || {
        // Validate before touching the filesystem.
        clean("name", &name)?;
        clean("email", &email)?;
        write_identity_at(&global_config_path()?, &name, &email)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_trimmed_identity_to_given_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cfg").join(".gitconfig");
        let id = write_identity_at(&file, "  Ada Lovelace ", " ada@example.com\t").unwrap();
        assert_eq!(id.name.as_deref(), Some("Ada Lovelace"));
        let cfg = git2::Config::open(&file).unwrap();
        assert_eq!(cfg.get_string("user.name").unwrap(), "Ada Lovelace");
        assert_eq!(cfg.get_string("user.email").unwrap(), "ada@example.com");
    }

    #[test]
    fn overwrites_existing_values() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(".gitconfig");
        write_identity_at(&file, "A", "a@x.io").unwrap();
        write_identity_at(&file, "B", "b@x.io").unwrap();
        let cfg = git2::Config::open(&file).unwrap();
        assert_eq!(cfg.get_string("user.name").unwrap(), "B");
    }

    #[test]
    fn rejects_bad_input_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(".gitconfig");
        for (n, e) in [
            ("", "a@x.io"),
            ("  ", "a@x.io"),
            ("A", ""),
            ("A\nB", "a@x.io"),
            ("A", "a@x\r.io"),
            ("A <b>", "a@x.io"),
            ("A", "<a@x.io>"),
        ] {
            let err = write_identity_at(&file, n, e).unwrap_err();
            assert_eq!(err.kind, ErrorKind::InvalidInput, "{n:?} {e:?}");
        }
        assert!(!file.exists());
    }
}
