//! `repo` commands. Phase 0 stubs: typed signatures are the contract;
//! bodies are filled in by the owning agent.
#![allow(unused_variables)]

use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::git::recent::{now_secs, RecentStore};
use crate::git::{blocking, GitState};
use crate::ipc::error::AppResult;
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
