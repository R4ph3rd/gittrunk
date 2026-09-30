//! `conflicts` commands: list, inspect and resolve conflicted files.

use crate::git::conflicts::ConflictService;
use crate::git::libgit::LibGit;
use crate::git::GitState;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn conflict_list(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
) -> AppResult<Vec<FileChange>> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.with_repo(&repo, |_, r| LibGit.conflict_list(r))).await
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_file(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    path: String,
) -> AppResult<ConflictFile> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.with_repo(&repo, |_, r| LibGit.conflict_file(r, &path))).await
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_resolve(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    path: String,
    resolution: ConflictResolution,
) -> AppResult<()> {
    let st = state.inner().clone();
    crate::git::blocking(move || {
        st.write_repo(&repo, |r| LibGit.conflict_resolve(r, &path, &resolution))
    })
    .await
}
