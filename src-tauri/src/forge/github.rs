//! GitHub REST client. Never logs; errors never contain the token.

use std::time::Duration;

use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde_json::{json, Value};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use super::Forge;
use crate::ai::provider::{clip, scrub, BoxFuture};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub const API_BASE: &str = "https://api.github.com";
pub const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BODY: usize = 65_536;
const MAX_TITLE: usize = 256;
const MAX_COMMENT_PAGES: u32 = 10;
const SIGN_IN_HINT: &str = "Add a GitHub token in Settings > Integrations";

pub struct GithubForge {
    client: reqwest::Client,
    api: String,
    owner: String,
    name: String,
    token: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Scope {
    Repo,
    Commit,
}

/// RFC 3339 to unix seconds; unparsable values read as 0.
pub fn parse_time(s: &str) -> f64 {
    OffsetDateTime::parse(s, &Rfc3339)
        .map(|t| t.unix_timestamp() as f64)
        .unwrap_or(0.0)
}

fn str_of(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn user_of(v: &Value) -> ForgeUser {
    ForgeUser {
        login: v
            .get("user")
            .and_then(|u| u.get("login"))
            .and_then(Value::as_str)
            .unwrap_or("ghost")
            .to_string(),
    }
}

fn issue_of(v: &Value) -> AppResult<Issue> {
    let number = v
        .get("number")
        .and_then(Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .ok_or_else(|| AppError::new(ErrorKind::Network, "Unexpected response from GitHub"))?;
    let labels = v
        .get("labels")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|l| {
                    l.get("name")
                        .and_then(Value::as_str)
                        .or_else(|| l.as_str())
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Issue {
        number,
        title: str_of(v, "title"),
        state: if str_of(v, "state") == "closed" {
            IssueState::Closed
        } else {
            IssueState::Open
        },
        author: user_of(v),
        labels,
        comments: v
            .get("comments")
            .and_then(Value::as_u64)
            .map_or(0, |n| u32::try_from(n).unwrap_or(u32::MAX)),
        created_at: parse_time(&str_of(v, "created_at")),
        updated_at: parse_time(&str_of(v, "updated_at")),
        url: str_of(v, "html_url"),
    })
}

fn comment_of(v: &Value) -> ForgeComment {
    ForgeComment {
        id: v.get("id").map(|i| i.to_string()).unwrap_or_default(),
        author: user_of(v),
        body: str_of(v, "body"),
        created_at: parse_time(&str_of(v, "created_at")),
        url: str_of(v, "html_url"),
    }
}

/// `page` parameter of the `rel="next"` entry of a `Link` header.
fn next_page(resp: &Response) -> Option<u32> {
    let link = resp.headers().get("link")?.to_str().ok()?;
    link.split(',').find_map(|part| {
        let (url, params) = part.split_once(';')?;
        if !params.contains("rel=\"next\"") {
            return None;
        }
        let query = url.trim().trim_start_matches('<').trim_end_matches('>');
        let query = query.split_once('?')?.1;
        query
            .split('&')
            .find_map(|kv| kv.strip_prefix("page=")?.parse().ok())
    })
}

fn reset_time(resp: &Response) -> Option<String> {
    let secs: i64 = resp
        .headers()
        .get("x-ratelimit-reset")?
        .to_str()
        .ok()?
        .parse()
        .ok()?;
    let t = OffsetDateTime::from_unix_timestamp(secs).ok()?;
    Some(format!("{:02}:{:02} UTC", t.hour(), t.minute()))
}

fn network(e: reqwest::Error) -> AppError {
    AppError::new(ErrorKind::Network, scrub(&e))
}

/// Maps a non-success response to an error (never includes credentials).
async fn error_for(resp: Response, authed: bool, scope: Scope) -> AppError {
    let status = resp.status();
    let rate_limited = resp
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|h| h.to_str().ok())
        == Some("0");
    let reset = reset_time(&resp);
    let text = resp.text().await.unwrap_or_default();
    let gh_message = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| v.get("message").and_then(Value::as_str).map(str::to_string))
        .map(|m| clip(&m, 300));
    let with_detail = |e: AppError| match &gh_message {
        Some(m) => e.with_detail(m.clone()),
        None => e,
    };
    match status {
        StatusCode::UNAUTHORIZED => with_detail(AppError::new(
            ErrorKind::AuthFailed,
            "GitHub rejected the token",
        )),
        StatusCode::FORBIDDEN if rate_limited => {
            let mut msg = match reset {
                Some(t) => format!("GitHub rate limit reached; resets at {t}"),
                None => "GitHub rate limit reached".to_string(),
            };
            if !authed {
                msg.push_str(" (add a token for a higher limit)");
            }
            with_detail(AppError::new(ErrorKind::Network, msg))
        }
        StatusCode::FORBIDDEN => with_detail(AppError::new(
            ErrorKind::AuthRequired,
            "The token cannot access this repository",
        )),
        StatusCode::NOT_FOUND if !authed => with_detail(AppError::new(
            ErrorKind::AuthRequired,
            "Repository not found or private: add a GitHub token",
        )),
        StatusCode::NOT_FOUND => with_detail(AppError::new(
            ErrorKind::InvalidInput,
            "Not found on GitHub",
        )),
        StatusCode::GONE => with_detail(AppError::new(
            ErrorKind::Unsupported,
            "Issues are disabled for this repository",
        )),
        StatusCode::UNPROCESSABLE_ENTITY if scope == Scope::Commit => with_detail(AppError::new(
            ErrorKind::InvalidInput,
            "This commit is not on GitHub",
        )),
        StatusCode::UNPROCESSABLE_ENTITY => AppError::new(
            ErrorKind::InvalidInput,
            gh_message.unwrap_or_else(|| "GitHub rejected the request".to_string()),
        ),
        s => with_detail(AppError::new(
            ErrorKind::Network,
            format!("GitHub returned HTTP {}", s.as_u16()),
        )),
    }
}

fn validate_body(body: &str) -> AppResult<()> {
    if body.chars().count() > MAX_BODY {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            "The text is too long (limit 65,536 characters)",
        ));
    }
    Ok(())
}

fn validate_comment(body: &str) -> AppResult<()> {
    if body.trim().is_empty() {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            "A comment cannot be empty",
        ));
    }
    validate_body(body)
}

fn validate_oid(oid: &str) -> AppResult<()> {
    if oid.len() == 40 && oid.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorKind::InvalidInput,
            "Not a full commit id",
        ))
    }
}

impl GithubForge {
    pub fn new(
        client: reqwest::Client,
        api: &str,
        owner: &str,
        name: &str,
        token: Option<String>,
    ) -> Self {
        Self {
            client,
            api: api.trim_end_matches('/').to_string(),
            owner: owner.to_string(),
            name: name.to_string(),
            token: token.filter(|t| !t.is_empty()),
        }
    }

    fn repo_path(&self, rest: &str) -> String {
        format!("{}/repos/{}/{}/{rest}", self.api, self.owner, self.name)
    }

    fn request(&self, method: Method, url: &str) -> RequestBuilder {
        authed(&self.client, &self.token, method, url)
    }

    fn require_token(&self) -> AppResult<()> {
        if self.token.is_none() {
            return Err(AppError::new(ErrorKind::AuthRequired, SIGN_IN_HINT));
        }
        Ok(())
    }

    async fn send(&self, rb: RequestBuilder, scope: Scope) -> AppResult<Response> {
        let resp = rb.send().await.map_err(network)?;
        if resp.status().is_success() {
            Ok(resp)
        } else {
            Err(error_for(resp, self.token.is_some(), scope).await)
        }
    }

    async fn json(resp: Response) -> AppResult<Value> {
        resp.json().await.map_err(network)
    }

    async fn do_list(&self, q: &IssueQuery) -> AppResult<IssuePage> {
        let state = match q.state {
            IssueStateFilter::Open => "open",
            IssueStateFilter::Closed => "closed",
            IssueStateFilter::All => "all",
        };
        let per_page = q.per_page.clamp(1, 100);
        let page = q.page.max(1);
        let url = self.repo_path(&format!(
            "issues?state={state}&per_page={per_page}&page={page}&sort=updated"
        ));
        let resp = self
            .send(self.request(Method::GET, &url), Scope::Repo)
            .await?;
        let next = next_page(&resp);
        let v = Self::json(resp).await?;
        let items = v
            .as_array()
            .ok_or_else(|| AppError::new(ErrorKind::Network, "Unexpected response from GitHub"))?
            .iter()
            .filter(|i| i.get("pull_request").is_none())
            .map(issue_of)
            .collect::<AppResult<Vec<_>>>()?;
        Ok(IssuePage {
            items,
            next_page: next,
        })
    }

    async fn comment_pages(&self, path: &str, scope: Scope) -> AppResult<Vec<ForgeComment>> {
        let mut out = Vec::new();
        let mut page = 1;
        for _ in 0..MAX_COMMENT_PAGES {
            let url = self.repo_path(&format!("{path}?per_page=100&page={page}"));
            let resp = self.send(self.request(Method::GET, &url), scope).await?;
            let next = next_page(&resp);
            let v = Self::json(resp).await?;
            if let Some(a) = v.as_array() {
                out.extend(a.iter().map(comment_of));
            }
            match next {
                Some(n) => page = n,
                None => break,
            }
        }
        Ok(out)
    }

    async fn do_issue(&self, number: u32) -> AppResult<IssueDetail> {
        let url = self.repo_path(&format!("issues/{number}"));
        let resp = self
            .send(self.request(Method::GET, &url), Scope::Repo)
            .await?;
        let v = Self::json(resp).await?;
        if v.get("pull_request").is_some() {
            return Err(AppError::new(
                ErrorKind::InvalidInput,
                format!("#{number} is a pull request"),
            ));
        }
        let issue = issue_of(&v)?;
        let comments = self
            .comment_pages(&format!("issues/{number}/comments"), Scope::Repo)
            .await?;
        Ok(IssueDetail {
            issue,
            body: str_of(&v, "body"),
            comments,
        })
    }

    async fn do_create(&self, req: &IssueCreateRequest) -> AppResult<Issue> {
        let title = req.title.trim();
        if title.is_empty() || title.chars().count() > MAX_TITLE {
            return Err(AppError::new(
                ErrorKind::InvalidInput,
                "The title must be 1 to 256 characters",
            ));
        }
        validate_body(&req.body)?;
        self.require_token()?;
        let url = self.repo_path("issues");
        let rb = self
            .request(Method::POST, &url)
            .json(&json!({ "title": title, "body": req.body }));
        let resp = self.send(rb, Scope::Repo).await?;
        issue_of(&Self::json(resp).await?)
    }

    async fn post_comment(&self, path: &str, body: &str, scope: Scope) -> AppResult<ForgeComment> {
        validate_comment(body)?;
        self.require_token()?;
        let url = self.repo_path(path);
        let rb = self
            .request(Method::POST, &url)
            .json(&json!({ "body": body }));
        let resp = self.send(rb, scope).await?;
        Ok(comment_of(&Self::json(resp).await?))
    }
}

fn authed(
    client: &reqwest::Client,
    token: &Option<String>,
    method: Method,
    url: &str,
) -> RequestBuilder {
    let rb = client
        .request(method, url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    match token {
        Some(t) => rb.bearer_auth(t),
        None => rb,
    }
}

/// Checks `token` against `GET {api}/user` and returns its owner.
pub async fn validate_token(
    client: &reqwest::Client,
    api: &str,
    token: &str,
) -> AppResult<ForgeUser> {
    let url = format!("{}/user", api.trim_end_matches('/'));
    let rb = authed(client, &Some(token.to_string()), Method::GET, &url);
    let resp = rb.send().await.map_err(network)?;
    if !resp.status().is_success() {
        return Err(error_for(resp, true, Scope::Repo).await);
    }
    let v: Value = resp.json().await.map_err(network)?;
    let login = v
        .get("login")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::new(ErrorKind::Network, "Unexpected response from GitHub"))?;
    Ok(ForgeUser {
        login: login.to_string(),
    })
}

impl Forge for GithubForge {
    fn list_issues<'a>(&'a self, q: &'a IssueQuery) -> BoxFuture<'a, AppResult<IssuePage>> {
        Box::pin(self.do_list(q))
    }

    fn issue<'a>(&'a self, number: u32) -> BoxFuture<'a, AppResult<IssueDetail>> {
        Box::pin(self.do_issue(number))
    }

    fn create_issue<'a>(&'a self, req: &'a IssueCreateRequest) -> BoxFuture<'a, AppResult<Issue>> {
        Box::pin(self.do_create(req))
    }

    fn comment_issue<'a>(
        &'a self,
        number: u32,
        body: &'a str,
    ) -> BoxFuture<'a, AppResult<ForgeComment>> {
        Box::pin(async move {
            self.post_comment(&format!("issues/{number}/comments"), body, Scope::Repo)
                .await
        })
    }

    fn commit_comments<'a>(&'a self, oid: &'a str) -> BoxFuture<'a, AppResult<Vec<ForgeComment>>> {
        Box::pin(async move {
            validate_oid(oid)?;
            self.comment_pages(&format!("commits/{oid}/comments"), Scope::Commit)
                .await
        })
    }

    fn comment_commit<'a>(
        &'a self,
        oid: &'a str,
        body: &'a str,
    ) -> BoxFuture<'a, AppResult<ForgeComment>> {
        Box::pin(async move {
            validate_oid(oid)?;
            self.post_comment(&format!("commits/{oid}/comments"), body, Scope::Commit)
                .await
        })
    }
}
