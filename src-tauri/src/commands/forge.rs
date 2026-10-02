//! `forge` commands: GitHub issues, comments and the forge token.
use crate::forge::tokens::{self, ForgeTokens, SystemTokens};
use crate::forge::{self, remote, Forge};
use crate::git::blocking;
use crate::git::remote::keychain::Keychain;
use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn forge_status(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
) -> AppResult<ForgeStatus> {
    let st = state.inner().clone();
    blocking(move || {
        let found = st.with_repo(&repo, |_, r| Ok(remote::detect(&remote::read_remotes(r))))?;
        let token_source = match &found {
            Some(fr) => tokens::resolve(&SystemTokens, &Keychain, &fr.host).1,
            None => ForgeTokenSource::None,
        };
        let supported = found.as_ref().is_some_and(|r| r.kind == ForgeKind::Github);
        Ok(ForgeStatus {
            repo: found,
            supported,
            token_source,
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_token_source(host: String) -> AppResult<ForgeTokenSource> {
    blocking(move || Ok(tokens::resolve(&SystemTokens, &Keychain, &host).1)).await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_token_set(host: String, token: String) -> AppResult<ForgeUser> {
    forge::set_token(forge::github::API_BASE, &SystemTokens, &host, &token).await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_token_clear(host: String) -> AppResult<()> {
    blocking(move || SystemTokens.clear(&host)).await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_issues(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    query: IssueQuery,
) -> AppResult<IssuePage> {
    forge::github_for(&state, &repo)
        .await?
        .list_issues(&query)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_issue(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    number: u32,
) -> AppResult<IssueDetail> {
    forge::github_for(&state, &repo).await?.issue(number).await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_issue_create(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    request: IssueCreateRequest,
) -> AppResult<Issue> {
    forge::github_for(&state, &repo)
        .await?
        .create_issue(&request)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_issue_comment(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    number: u32,
    body: String,
) -> AppResult<ForgeComment> {
    forge::github_for(&state, &repo)
        .await?
        .comment_issue(number, &body)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_commit_comments(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    oid: Oid,
) -> AppResult<Vec<ForgeComment>> {
    forge::github_for(&state, &repo)
        .await?
        .commit_comments(&oid)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_commit_comment(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    oid: Oid,
    body: String,
) -> AppResult<ForgeComment> {
    forge::github_for(&state, &repo)
        .await?
        .comment_commit(&oid, &body)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_pulls(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    query: PullQuery,
) -> AppResult<PullPage> {
    forge::github_for(&state, &repo)
        .await?
        .list_pulls(&query)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_pull(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    number: u32,
) -> AppResult<PullDetail> {
    forge::github_for(&state, &repo).await?.pull(number).await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_pull_comment(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    number: u32,
    body: String,
) -> AppResult<ForgeComment> {
    forge::github_for(&state, &repo)
        .await?
        .comment_pull(number, &body)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn forge_notifications(_host: String) -> AppResult<Vec<ForgeNotification>> {
    Err(AppError::not_implemented("forge_notifications"))
}
