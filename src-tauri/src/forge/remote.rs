//! Forge detection from a repository's remotes (pure parsing, no network).

use crate::git::remote::provider::host_of;
use crate::ipc::types::{ForgeKind, ForgeRepo};

pub const GITHUB_HOST: &str = "github.com";

fn valid_segment(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// `(host, owner, name)` of a remote URL. Credentials in the URL are dropped.
/// Accepts `https://[user[:pw]@]host/o/n[.git][/]`, `git@host:o/n[.git]` and
/// `ssh://git@host[:port]/o/n[.git]`.
pub fn parse_url(url: &str) -> Option<(String, String, String)> {
    let url = url.trim();
    let host = host_of(url)?;
    let path = if let Some((_, rest)) = url.split_once("://") {
        let (_, path) = rest.split_once('/')?;
        path
    } else {
        url.split_once(':')?.1
    };
    let path = path.split(['?', '#']).next().unwrap_or("");
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, name) = path.split_once('/')?;
    if !valid_segment(owner) || !valid_segment(name) {
        return None;
    }
    Some((host, owner.to_string(), name.to_string()))
}

fn forge_kind(host: &str) -> Option<ForgeKind> {
    if host == GITHUB_HOST {
        Some(ForgeKind::Github)
    } else if host == "gitlab.com" || host.starts_with("gitlab.") {
        Some(ForgeKind::Gitlab)
    } else {
        None
    }
}

fn to_repo(remote: &str, url: &str) -> Option<ForgeRepo> {
    let (host, owner, name) = parse_url(url)?;
    let kind = forge_kind(&host)?;
    Some(ForgeRepo {
        kind,
        web_url: format!("https://{host}/{owner}/{name}"),
        host,
        owner,
        name,
        remote: remote.to_string(),
    })
}

/// `origin` when it points at a known forge, else the first GitHub remote,
/// else the first GitLab remote. `remotes` is `(name, url)` in config order.
pub fn detect(remotes: &[(String, String)]) -> Option<ForgeRepo> {
    let all: Vec<ForgeRepo> = remotes.iter().filter_map(|(n, u)| to_repo(n, u)).collect();
    all.iter()
        .find(|r| r.remote == "origin")
        .or_else(|| all.iter().find(|r| r.kind == ForgeKind::Github))
        .or_else(|| all.first())
        .cloned()
}

/// `(name, url)` of every remote with a URL.
pub fn read_remotes(repo: &git2::Repository) -> Vec<(String, String)> {
    let Ok(names) = repo.remotes() else {
        return Vec::new();
    };
    (0..names.len())
        .filter_map(|i| {
            let n = names.get(i).ok().flatten()?;
            let r = repo.find_remote(n).ok()?;
            let url = r.url().map(str::to_string).ok()?;
            Some((n.to_string(), url))
        })
        .collect()
}
