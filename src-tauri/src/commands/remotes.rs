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
        add_remote(
            || st.write_repo(&repo, |r| LibGit.remote_add(r, &request)),
            request.fetch,
            |info| {
                let sess = ops::sync_session(&app, &st, st.cli().clone())?;
                let git_dir = st.entry(&repo)?.git_dir.clone();
                let dir = net::run_dir(&Repository::open(&git_dir)?);
                let fetch = FetchRequest {
                    remote: Some(info.name.clone()),
                    prune: false,
                    tags: false,
                };
                net::fetch(&sess, &dir, &fetch)?;
                st.entry(&repo)?.invalidate_graph();
                Ok(())
            },
        )
    })
    .await
}

/// Adds the remote, then optionally fetches it. The fetch is best effort: the
/// remote may not exist yet (it is about to be created on the host) or be
/// unreachable, and that must never fail the add.
fn add_remote(
    add: impl FnOnce() -> AppResult<RemoteInfo>,
    fetch: bool,
    do_fetch: impl FnOnce(&RemoteInfo) -> AppResult<()>,
) -> AppResult<RemoteInfo> {
    let info = add()?;
    if fetch {
        // Intentionally ignored; the UI offers an explicit fetch with visible errors.
        let _ = do_fetch(&info);
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::fixtures;
    use crate::ipc::error::ErrorKind;

    #[test]
    fn add_succeeds_when_the_remote_does_not_exist() {
        let t = fixtures::empty();
        let req = RemoteAddRequest {
            name: "origin".into(),
            url: "https://github.com/nobody/does-not-exist.git".into(),
            fetch: true,
        };
        let info = add_remote(
            || LibGit.remote_add(&t.repo, &req),
            true,
            |_| Err(AppError::new(ErrorKind::Network, "Repository not found")),
        )
        .unwrap();
        assert_eq!(info.name, "origin");
        assert_eq!(LibGit.remote_list(&t.repo).unwrap().len(), 1);
    }

    #[test]
    fn add_errors_still_fail() {
        let err = add_remote(
            || Err(AppError::new(ErrorKind::InvalidInput, "bad name")),
            true,
            |_| Ok(()),
        )
        .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput);
    }
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

/// Background fetch of all remotes: never prompts for credentials. The UI
/// tracks it like any op but stays silent about the outcome.
#[tauri::command]
#[specta::specta]
pub async fn fetch_background(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    repo: RepoId,
    prune: bool,
) -> AppResult<OpId> {
    let request = FetchRequest {
        remote: None,
        prune,
        tags: false,
    };
    let entry = state.entry(&repo)?;
    let git_dir = entry.git_dir.clone();
    Ok(ops::spawn_op_with(
        app,
        state.inner(),
        Some(entry),
        true,
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
