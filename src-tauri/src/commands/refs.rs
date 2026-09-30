//! `refs` commands: listing plus the ref-level write operations.

use crate::git::libgit::LibGit;
use crate::git::refs_write::RefWriteService;
use crate::git::GitState;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn refs_list(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
) -> AppResult<RefsSnapshot> {
    let st = state.inner().clone();
    crate::git::blocking(move || st.with_repo(&repo, |svc, r| svc.refs_list(r))).await
}

macro_rules! ref_write {
    ($state:expr, $repo:expr, |$r:ident| $body:expr) => {{
        let st = $state.inner().clone();
        crate::git::blocking(move || st.write_repo(&$repo, |$r| $body)).await
    }};
}

// `branch_create`, `branch_rename` and `tag_create` have no `dry_run`
// parameter in the IPC contract, so they always apply.

#[tauri::command]
#[specta::specta]
pub async fn branch_create(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: BranchCreateRequest,
) -> AppResult<OpOutcome> {
    ref_write!(state, repo, |r| LibGit.branch_create(r, &request, false))
}

#[tauri::command]
#[specta::specta]
pub async fn branch_delete(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: BranchDeleteRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    ref_write!(state, repo, |r| LibGit.branch_delete(r, &request, dry_run))
}

#[tauri::command]
#[specta::specta]
pub async fn branch_rename(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    old_name: String,
    new_name: String,
) -> AppResult<OpOutcome> {
    ref_write!(state, repo, |r| LibGit
        .branch_rename(r, &old_name, &new_name, false))
}

#[tauri::command]
#[specta::specta]
pub async fn checkout(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    target: CheckoutTarget,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    ref_write!(state, repo, |r| LibGit.checkout(r, &target, dry_run))
}

#[tauri::command]
#[specta::specta]
pub async fn tag_create(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: TagCreateRequest,
) -> AppResult<OpOutcome> {
    ref_write!(state, repo, |r| LibGit.tag_create(r, &request, false))
}

#[tauri::command]
#[specta::specta]
pub async fn tag_delete(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    name: String,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    ref_write!(state, repo, |r| LibGit.tag_delete(r, &name, dry_run))
}

#[tauri::command]
#[specta::specta]
pub async fn ref_move(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: RefMoveRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    ref_write!(state, repo, |r| LibGit.ref_move(r, &request, dry_run))
}
