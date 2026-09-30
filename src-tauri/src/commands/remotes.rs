//! `remotes` commands: remote management, network operations and credentials.

use git2::Repository;

use crate::git::libgit::LibGit;
use crate::git::remote::keychain::{self, Keychain};
use crate::git::remote::{net, ops, RemoteService};
use crate::git::{blocking, GitState};
use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

/// Runs a management call against the locked repository handle.
macro_rules! manage {
    ($state:expr, $repo:expr, |$r:ident| $body:expr) => {{
        let st = $state.inner().clone();
        blocking(move || st.write_repo(&$repo, |$r| $body)).await
    }};
}

#[tauri::command]
#[specta::specta]
pub async fn remote_list(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
) -> AppResult<Vec<RemoteInfo>> {
    let st = state.inner().clone();
    blocking(move || st.with_repo(&repo, |_, r| LibGit.remote_list(r))).await
}

#[tauri::command]
#[specta::specta]
pub async fn remote_add(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: RemoteAddRequest,
) -> AppResult<RemoteInfo> {
    let st = state.inner().clone();
    blocking(move || {
        let info = st.write_repo(&repo, |r| LibGit.remote_add(r, &request))?;
        if request.fetch {
            let sess = ops::sync_session(&app, &st, st.cli().clone())?;
            let git_dir = st.entry(&repo)?.git_dir.clone();
            let dir = net::run_dir(&Repository::open(&git_dir)?);
            let fetch = FetchRequest {
                remote: Some(info.name.clone()),
                prune: false,
                tags: false,
            };
            net::fetch(&sess, &dir, &fetch).map_err(|mut e| {
                e.message = format!("Remote added, but fetching failed: {}", e.message);
                e
            })?;
            st.entry(&repo)?.invalidate_graph();
        }
        Ok(info)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn remote_remove(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    name: String,
) -> AppResult<()> {
    manage!(state, repo, |r| LibGit.remote_remove(r, &name))
}

#[tauri::command]
#[specta::specta]
pub async fn remote_rename(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    old_name: String,
    new_name: String,
) -> AppResult<()> {
    manage!(state, repo, |r| LibGit
        .remote_rename(r, &old_name, &new_name))
}

#[tauri::command]
#[specta::specta]
pub async fn remote_set_url(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    name: String,
    url: String,
    push: bool,
) -> AppResult<()> {
    manage!(state, repo, |r| LibGit.remote_set_url(r, &name, &url, push))
}

#[tauri::command]
#[specta::specta]
pub async fn fetch(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: FetchRequest,
) -> AppResult<OpId> {
    net::fetch_args(&request)?;
    let entry = state.entry(&repo)?;
    let git_dir = entry.git_dir.clone();
    Ok(ops::spawn_op(
        app,
        state.inner(),
        Some(entry),
        move |sess| {
            let dir = net::run_dir(&Repository::open(&git_dir)?);
            net::fetch(sess, &dir, &request)?;
            Ok(None)
        },
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn pull(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: PullRequest,
) -> AppResult<OpId> {
    net::pull_args(&request)?;
    let entry = state.entry(&repo)?;
    let git_dir = entry.git_dir.clone();
    Ok(ops::spawn_op(
        app,
        state.inner(),
        Some(entry),
        move |sess| {
            // Own handle: the shared one stays available to reads while git runs.
            let repo = Repository::open(&git_dir)?;
            net::pull(sess, &repo, &request).map(Some)
        },
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn push(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    request: PushRequest,
) -> AppResult<OpId> {
    net::push_args(&request)?;
    let entry = state.entry(&repo)?;
    let git_dir = entry.git_dir.clone();
    Ok(ops::spawn_op(
        app,
        state.inner(),
        Some(entry),
        move |sess| {
            let dir = net::run_dir(&Repository::open(&git_dir)?);
            net::push(sess, &dir, &request)?;
            Ok(None)
        },
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn set_upstream(
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    branch: String,
    upstream: Option<String>,
) -> AppResult<()> {
    manage!(state, repo, |r| LibGit.set_upstream(
        r,
        &branch,
        upstream.as_deref()
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn credential_respond(
    state: tauri::State<'_, GitState>,
    request_id: String,
    value: Option<String>,
    remember: bool,
) -> AppResult<()> {
    state.credentials().respond(&request_id, value, remember)
}

#[tauri::command]
#[specta::specta]
pub async fn credential_store(request: CredentialStoreRequest) -> AppResult<()> {
    if request.host.trim().is_empty() || request.username.is_empty() {
        return Err(AppError::new(
            crate::ipc::error::ErrorKind::InvalidInput,
            "host and username are required",
        ));
    }
    blocking(move || keychain::store(&Keychain, &request.host, &request.username, &request.secret))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn credential_clear(host: String) -> AppResult<()> {
    blocking(move || keychain::clear(&Keychain, &host)).await
}
