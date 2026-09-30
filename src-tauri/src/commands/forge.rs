//! `forge` commands. Stubs until M9 Wave 1.
use crate::ipc::error::{AppError, AppResult};
use crate::ipc::types::*;

#[tauri::command]
#[specta::specta]
pub async fn forge_status(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
) -> AppResult<ForgeStatus> {
    let _ = (&state, &repo);
    Err(AppError::not_implemented("forge_status"))
}

#[tauri::command]
#[specta::specta]
pub async fn forge_token_source(host: String) -> AppResult<ForgeTokenSource> {
    let _ = &host;
    Err(AppError::not_implemented("forge_token_source"))
}

#[tauri::command]
#[specta::specta]
pub async fn forge_token_set(host: String, token: String) -> AppResult<ForgeUser> {
    let _ = (&host, &token);
    Err(AppError::not_implemented("forge_token_set"))
}

#[tauri::command]
#[specta::specta]
pub async fn forge_token_clear(host: String) -> AppResult<()> {
    let _ = &host;
    Err(AppError::not_implemented("forge_token_clear"))
}

#[tauri::command]
#[specta::specta]
pub async fn forge_issues(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    query: IssueQuery,
) -> AppResult<IssuePage> {
    let _ = (&state, &repo, &query);
    Err(AppError::not_implemented("forge_issues"))
}

#[tauri::command]
#[specta::specta]
pub async fn forge_issue(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    number: u32,
) -> AppResult<IssueDetail> {
    let _ = (&state, &repo, &number);
    Err(AppError::not_implemented("forge_issue"))
}

#[tauri::command]
#[specta::specta]
pub async fn forge_issue_create(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    request: IssueCreateRequest,
) -> AppResult<Issue> {
    let _ = (&state, &repo, &request);
    Err(AppError::not_implemented("forge_issue_create"))
}

#[tauri::command]
#[specta::specta]
pub async fn forge_issue_comment(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    number: u32,
    body: String,
) -> AppResult<ForgeComment> {
    let _ = (&state, &repo, &number, &body);
    Err(AppError::not_implemented("forge_issue_comment"))
}

#[tauri::command]
#[specta::specta]
pub async fn forge_commit_comments(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    oid: Oid,
) -> AppResult<Vec<ForgeComment>> {
    let _ = (&state, &repo, &oid);
    Err(AppError::not_implemented("forge_commit_comments"))
}

#[tauri::command]
#[specta::specta]
pub async fn forge_commit_comment(
    state: tauri::State<'_, crate::git::GitState>,
    repo: RepoId,
    oid: Oid,
    body: String,
) -> AppResult<ForgeComment> {
    let _ = (&state, &repo, &oid, &body);
    Err(AppError::not_implemented("forge_commit_comment"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::error::ErrorKind;
    use tauri::Manager;

    #[test]
    fn stubs_are_not_implemented() {
        let app = tauri::test::mock_app();
        app.manage(crate::git::GitState::default());
        let st = || app.state::<crate::git::GitState>();
        let repo = || "r".to_string();
        let oid = || "0".repeat(40);
        let kind = |e: AppError| e.kind;
        tauri::async_runtime::block_on(async {
            let nie = ErrorKind::NotImplemented;
            assert_eq!(kind(forge_status(st(), repo()).await.unwrap_err()), nie);
            assert_eq!(kind(forge_token_source("h".into()).await.unwrap_err()), nie);
            assert_eq!(
                kind(forge_token_set("h".into(), "t".into()).await.unwrap_err()),
                nie
            );
            assert_eq!(kind(forge_token_clear("h".into()).await.unwrap_err()), nie);
            let query = IssueQuery {
                state: IssueStateFilter::All,
                page: 1,
                per_page: 30,
            };
            assert_eq!(
                kind(forge_issues(st(), repo(), query).await.unwrap_err()),
                nie
            );
            assert_eq!(kind(forge_issue(st(), repo(), 1).await.unwrap_err()), nie);
            let req = IssueCreateRequest {
                title: "t".into(),
                body: "b".into(),
            };
            assert_eq!(
                kind(forge_issue_create(st(), repo(), req).await.unwrap_err()),
                nie
            );
            assert_eq!(
                kind(
                    forge_issue_comment(st(), repo(), 1, "b".into())
                        .await
                        .unwrap_err()
                ),
                nie
            );
            assert_eq!(
                kind(
                    forge_commit_comments(st(), repo(), oid())
                        .await
                        .unwrap_err()
                ),
                nie
            );
            assert_eq!(
                kind(
                    forge_commit_comment(st(), repo(), oid(), "b".into())
                        .await
                        .unwrap_err()
                ),
                nie
            );
        });
    }
}
