//! `graph` commands.

use crate::git::{blocking, GitState};
use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn graph_load(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    filter: GraphFilter,
) -> AppResult<GraphMeta> {
    let st = state.inner().clone();
    blocking(move || st.graph_load(&repo, filter)).await
}

#[tauri::command]
#[specta::specta]
pub async fn graph_rows(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    start: u32,
    len: u32,
) -> AppResult<Vec<GraphRow>> {
    let st = state.inner().clone();
    blocking(move || Ok(st.graph(&repo)?.rows(start, len))).await
}

#[tauri::command]
#[specta::specta]
pub async fn graph_search(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    search: GraphSearch,
) -> AppResult<Vec<u32>> {
    let st = state.inner().clone();
    blocking(move || Ok(st.graph(&repo)?.search(&search))).await
}

#[tauri::command]
#[specta::specta]
pub async fn commit_details(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    oid: Oid,
) -> AppResult<CommitDetails> {
    let st = state.inner().clone();
    blocking(move || st.with_repo(&repo, |svc, r| svc.commit_details(r, &oid))).await
}

#[tauri::command]
#[specta::specta]
pub async fn commit_file_diff(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    oid: Oid,
    path: String,
    options: DiffOptions,
) -> AppResult<FileDiff> {
    let st = state.inner().clone();
    blocking(move || {
        st.with_repo(&repo, |svc, r| {
            svc.commit_file_diff(r, &oid, &path, &options)
        })
    })
    .await
}

/// Row index of `oid` in the currently loaded graph, `None` when it is filtered out.
#[tauri::command]
#[specta::specta]
pub async fn graph_find(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    oid: Oid,
) -> AppResult<Option<u32>> {
    let _ = (state, repo, oid);
    Err(AppError::not_implemented("graph_find"))
}
