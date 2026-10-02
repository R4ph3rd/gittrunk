//! GitHub notifications (unread threads of the token's user). Read only.

use reqwest::{Method, StatusCode};
use serde_json::Value;

use super::github::{authed, error_for, network, parse_time, Scope};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::ForgeNotification;

const WEB_BASE: &str = "https://github.com";

/// Unread notification threads of the token's user.
pub async fn list(
    client: &reqwest::Client,
    api: &str,
    token: Option<&str>,
) -> AppResult<Vec<ForgeNotification>> {
    let Some(token) = token.filter(|t| !t.is_empty()) else {
        return Err(AppError::new(
            ErrorKind::AuthRequired,
            "Add a GitHub token in Settings > Integrations to see GitHub notifications",
        ));
    };
    let url = format!("{}/notifications?per_page=50", api.trim_end_matches('/'));
    let resp = authed(client, &Some(token.to_string()), Method::GET, &url)
        .send()
        .await
        .map_err(network)?;
    let status = resp.status();
    if status == StatusCode::FORBIDDEN {
        return Err(AppError::new(
            ErrorKind::Unsupported,
            "This token cannot read notifications. Use a classic token with the notifications scope.",
        ));
    }
    if !status.is_success() {
        return Err(error_for(resp, true, Scope::Repo).await);
    }
    let v: Value = resp.json().await.map_err(network)?;
    let items = v
        .as_array()
        .ok_or_else(|| AppError::new(ErrorKind::Network, "Unexpected response from GitHub"))?;
    Ok(items.iter().filter_map(notification_of).collect())
}

fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn notification_of(v: &Value) -> Option<ForgeNotification> {
    let id = v.get("id").and_then(Value::as_str)?.to_string();
    let subject = v.get("subject").unwrap_or(&Value::Null);
    let repo = v
        .get("repository")
        .map(|r| text(r, "full_name"))
        .unwrap_or_default();
    let kind = text(subject, "type");
    Some(ForgeNotification {
        id,
        title: text(subject, "title").to_string(),
        kind: kind.to_string(),
        reason: text(v, "reason").to_string(),
        repo: repo.to_string(),
        unread: v.get("unread").and_then(Value::as_bool).unwrap_or(true),
        updated_at: parse_time(text(v, "updated_at")),
        url: web_url(subject.get("url").and_then(Value::as_str), kind, repo),
    })
}

fn safe_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && s.chars().any(|c| c != '.')
}

fn safe_repo(full: &str) -> Option<(&str, &str)> {
    let (owner, name) = full.split_once('/')?;
    (safe_segment(owner) && safe_segment(name)).then_some((owner, name))
}

/// Web page for a notification subject, always under https://github.com/.
pub fn web_url(
    subject_url: Option<&str>,
    _subject_type: &str,
    repo_full_name: &str,
) -> Option<String> {
    let page = |owner: &str, name: &str| format!("{WEB_BASE}/{owner}/{name}");
    let fallback = safe_repo(repo_full_name).map(|(o, n)| page(o, n));
    let Some(rest) = subject_url
        .and_then(|u| u.split_once("/repos/"))
        .map(|p| p.1)
    else {
        return fallback;
    };
    let rest = rest.split(['?', '#']).next().unwrap_or_default();
    let parts: Vec<&str> = rest.split('/').collect();
    let [owner, name, kind, id] = parts[..] else {
        return fallback.or_else(|| {
            let (o, n) = (parts.first()?, parts.get(1)?);
            (safe_segment(o) && safe_segment(n)).then(|| page(o, n))
        });
    };
    if !safe_segment(owner) || !safe_segment(name) {
        return fallback;
    }
    let digits = !id.is_empty() && id.len() <= 10 && id.bytes().all(|b| b.is_ascii_digit());
    let hex = (7..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_hexdigit());
    let path = match kind {
        "pulls" if digits => format!("pull/{id}"),
        "issues" if digits => format!("issues/{id}"),
        "commits" if hex => format!("commit/{id}"),
        _ => return Some(page(owner, name)),
    };
    Some(format!("{}/{path}", page(owner, name)))
}
