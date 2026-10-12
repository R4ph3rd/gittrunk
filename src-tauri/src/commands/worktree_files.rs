//! Path-level working-copy commands: ignore, untrack, external difftool and
//! patch export (the Changes panel context menu).

use crate::git::staging::files;
use crate::git::GitState;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn ignore_add(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    patterns: Vec<String>,
    target: IgnoreTarget,
    dry_run: bool,
) -> AppResult<IgnoreAddResult> {
    let st = state.inner().clone();
    crate::git::blocking(move || {
        st.write_repo(&repo, |r| files::ignore_add(r, &patterns, target, dry_run))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn untrack_paths(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    paths: Vec<String>,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.write_repo(&repo, |r| files::untrack_paths(r, &paths, dry_run)))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn difftool_open(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    path: String,
    staged: bool,
) -> AppResult<()> {
    let st = state.inner().clone();
    let cli = st.cli();
    crate::git::blocking(move || {
        st.with_repo(&repo, |_, r| files::difftool_open(r, &cli, &path, staged))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn diff_patch(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    paths: Vec<String>,
    staged: bool,
) -> AppResult<String> {
    let st = state.inner().clone();
    crate::git::blocking(move || {
        st.with_repo(&repo, |_, r| {
            files::diff_patch(r, &paths, staged).map(|b| String::from_utf8_lossy(&b).into_owned())
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn diff_patch_save(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    paths: Vec<String>,
    staged: bool,
    dest: String,
) -> AppResult<u32> {
    let st = state.inner().clone();
    crate::git::blocking(move || {
        st.with_repo(&repo, |_, r| {
            files::diff_patch_save(r, &paths, staged, &dest)
        })
    })
    .await
}
