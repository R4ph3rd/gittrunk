//! Forge integration (GitHub issues and comments).

pub mod github;
pub mod remote;
pub mod tokens;

#[cfg(test)]
mod tests;

use crate::ai::provider::BoxFuture;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub use github::GithubForge;

/// A code forge's issue and comment API.
pub trait Forge: Send + Sync {
    fn list_issues<'a>(&'a self, q: &'a IssueQuery) -> BoxFuture<'a, AppResult<IssuePage>>;
    fn issue<'a>(&'a self, number: u32) -> BoxFuture<'a, AppResult<IssueDetail>>;
    fn create_issue<'a>(&'a self, req: &'a IssueCreateRequest) -> BoxFuture<'a, AppResult<Issue>>;
    fn comment_issue<'a>(
        &'a self,
        number: u32,
        body: &'a str,
    ) -> BoxFuture<'a, AppResult<ForgeComment>>;
    fn commit_comments<'a>(&'a self, oid: &'a str) -> BoxFuture<'a, AppResult<Vec<ForgeComment>>>;
    fn comment_commit<'a>(
        &'a self,
        oid: &'a str,
        body: &'a str,
    ) -> BoxFuture<'a, AppResult<ForgeComment>>;
}

/// Validates `token` against GitHub and stores it for `host` (only
/// `github.com`). Nothing is stored when GitHub rejects it.
pub async fn set_token(
    api: &str,
    tokens: &dyn tokens::ForgeTokens,
    host: &str,
    token: &str,
) -> AppResult<ForgeUser> {
    if host != remote::GITHUB_HOST {
        return Err(AppError::new(
            ErrorKind::Unsupported,
            "Only github.com tokens are supported",
        ));
    }
    let token = tokens::clean_token(token)?;
    let client = crate::http::client(github::TIMEOUT)?;
    let user = github::validate_token(&client, api, &token).await?;
    tokens.set(host, &token)?;
    Ok(user)
}

/// The GitHub forge for the repository's remotes, authenticated with the best
/// available token. Not GitHub -> `Unsupported`.
pub async fn github_for(state: &crate::git::GitState, repo: &str) -> AppResult<GithubForge> {
    let st = state.clone();
    let id = repo.to_string();
    let (fr, token) = crate::git::blocking(move || {
        let forge_repo = st.with_repo(&id, |_, r| Ok(remote::detect(&remote::read_remotes(r))))?;
        let Some(fr) = forge_repo.filter(|r| r.kind == ForgeKind::Github) else {
            return Err(AppError::new(
                ErrorKind::Unsupported,
                "Issues need a GitHub remote",
            ));
        };
        let (token, _) = tokens::resolve(
            &tokens::SystemTokens,
            &crate::git::remote::keychain::Keychain,
            &fr.host,
        );
        Ok((fr, token))
    })
    .await?;
    let client = crate::http::client(github::TIMEOUT)?;
    Ok(GithubForge::new(
        client,
        github::API_BASE,
        &fr.owner,
        &fr.name,
        token,
    ))
}
