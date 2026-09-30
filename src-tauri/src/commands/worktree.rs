//! `worktree` commands: status, diffs, staging, discard and commit.

use crate::git::libgit::LibGit;
use crate::git::staging::StagingService;
use crate::git::GitState;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn status(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
) -> AppResult<StatusSnapshot> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.with_repo(&repo, |svc, r| svc.status(r))).await
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_file_diff(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    path: String,
    staged: bool,
    options: DiffOptions,
) -> AppResult<FileDiff> {
    let st = state.inner().clone();
    crate::git::blocking(move || {
        st.with_repo(&repo, |svc, r| {
            svc.worktree_file_diff(r, &path, staged, &options)
        })
    })
    .await
}

macro_rules! wc_write {
    ($state:expr, $repo:expr, |$r:ident| $body:expr) => {{
        let st = $state.inner().clone();
        crate::git::blocking(move || st.write_repo(&$repo, |$r| $body)).await
    }};
}

#[tauri::command]
#[specta::specta]
pub async fn stage_paths(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    paths: Vec<String>,
) -> AppResult<()> {
    wc_write!(state, repo, |r| LibGit.stage_paths(r, &paths))
}

#[tauri::command]
#[specta::specta]
pub async fn unstage_paths(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    paths: Vec<String>,
) -> AppResult<()> {
    wc_write!(state, repo, |r| LibGit.unstage_paths(r, &paths))
}

#[tauri::command]
#[specta::specta]
pub async fn discard_paths(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    paths: Vec<String>,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    wc_write!(state, repo, |r| LibGit.discard_paths(r, &paths, dry_run))
}

#[tauri::command]
#[specta::specta]
pub async fn stage_lines(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    selection: LineSelection,
) -> AppResult<()> {
    wc_write!(state, repo, |r| LibGit.stage_lines(r, &selection))
}

#[tauri::command]
#[specta::specta]
pub async fn unstage_lines(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    selection: LineSelection,
) -> AppResult<()> {
    wc_write!(state, repo, |r| LibGit.unstage_lines(r, &selection))
}

#[tauri::command]
#[specta::specta]
pub async fn discard_lines(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    selection: LineSelection,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    wc_write!(state, repo, |r| LibGit
        .discard_lines(r, &selection, dry_run))
}

#[tauri::command]
#[specta::specta]
pub async fn commit_create(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: CommitRequest,
) -> AppResult<OpOutcome> {
    let cli = state.cli().clone();
    wc_write!(state, repo, |r| LibGit.commit_create(r, &cli, &request))
}
