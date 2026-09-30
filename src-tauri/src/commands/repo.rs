//! `repo` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::git::recent::{now_secs, RecentStore};
use crate::git::{blocking, GitState};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

fn recent_store(app: &tauri::AppHandle) -> Option<RecentStore> {
    let dir: PathBuf = app.path().app_data_dir().ok()?;
    Some(RecentStore::new(dir))
}

fn record_recent(app: &tauri::AppHandle, info: &RepoInfo) {
    if let Some(store) = recent_store(app) {
        let _ = store.record(&info.path, &info.name, now_secs());
    }
}

#[tauri::command]
#[specta::specta]
pub async fn repo_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    path: String,
) -> AppResult<RepoInfo> {
    let st = state.inner().clone();
    blocking(move || {
        let (entry, info) = st.open(Path::new(&path))?;
        st.ensure_watcher(&entry, app.clone());
        record_recent(&app, &info);
        Ok(info)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_init(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    request: InitRequest,
) -> AppResult<RepoInfo> {
    let st = state.inner().clone();
    blocking(move || {
        let (entry, info) = st.init(&request)?;
        st.ensure_watcher(&entry, app.clone());
        record_recent(&app, &info);
        Ok(info)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_clone(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    request: CloneRequest,
) -> AppResult<OpId> {
    // Validate up front so bad input fails the command instead of the op.
    crate::git::remote::net::clone_target(&request)?;
    Ok(crate::git::remote::ops::spawn_op(
        app,
        state.inner(),
        None,
        move |sess| {
            crate::git::remote::net::clone(sess, &request)?;
            Ok(None)
        },
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn repo_close(state: tauri::State<'_, GitState>, repo: RepoId) -> AppResult<()> {
    state.close(&repo)
}

#[tauri::command]
#[specta::specta]
pub async fn repo_info(state: tauri::State<'_, GitState>, repo: RepoId) -> AppResult<RepoInfo> {
    let st = state.inner().clone();
    blocking(move || st.with_repo(&repo, |svc, r| svc.repo_info(r, &repo))).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_recent(app: tauri::AppHandle) -> AppResult<Vec<RecentRepo>> {
    Ok(recent_store(&app).map(|s| s.load()).unwrap_or_default())
}

/// Resolves `path` and checks it lies strictly inside `root` (both
/// canonicalized, so `..` and symlink escapes are caught).
pub(crate) fn guard_delete_target(root: &Path, path: &Path) -> AppResult<PathBuf> {
    let root = root.canonicalize()?;
    let target = path
        .canonicalize()
        .map_err(|e| AppError::new(ErrorKind::InvalidInput, format!("cannot resolve path: {e}")))?;
    if target == root || !target.starts_with(&root) {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            "path is not inside the default repositories folder",
        ));
    }
    Ok(target)
}

/// Deletes a repository folder under the default repos dir (mobile/embedded).
#[tauri::command]
#[specta::specta]
pub async fn repo_delete(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    path: String,
) -> AppResult<()> {
    let root = super::app::default_repos_dir(&app)
        .ok_or_else(|| AppError::unsupported("Deleting repositories"))?;
    let st = state.inner().clone();
    let store = recent_store(&app);
    blocking(move || {
        let target = guard_delete_target(&root, Path::new(&path))?;
        st.close_path(&target);
        if let Some(store) = store {
            store.remove_path(Path::new(&path))?;
            store.remove_path(&target)?;
        }
        std::fs::remove_dir_all(&target)?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guard_accepts_strictly_inside() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("proj");
        std::fs::create_dir(&repo).unwrap();
        let got = guard_delete_target(dir.path(), &repo).unwrap();
        assert_eq!(got, repo.canonicalize().unwrap());
    }

    #[test]
    fn guard_rejects_root_outside_and_dotdot() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repos");
        std::fs::create_dir_all(root.join("a")).unwrap();
        let outside = dir.path().join("other");
        std::fs::create_dir(&outside).unwrap();
        for bad in [
            root.clone(),
            root.join("a").join(".."),
            root.join("..").join("other"),
            outside.clone(),
            dir.path().to_path_buf(),
            root.join("missing"),
        ] {
            let err = guard_delete_target(&root, &bad).unwrap_err();
            assert_eq!(err.kind, ErrorKind::InvalidInput, "{bad:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn guard_rejects_symlink_escape() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repos");
        std::fs::create_dir(&root).unwrap();
        let outside = dir.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        let err = guard_delete_target(&root, &root.join("link")).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput);
        assert!(outside.exists());
    }
}
