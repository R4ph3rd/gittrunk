//! Host extraction and provider detection for remote URLs.

use crate::ipc::types::RemoteProvider;

/// Lower-case host of `url`: `https://`, `ssh://`, `git://` URLs and scp-style
/// `user@host:path`. `None` for local paths.
pub fn host_of(url: &str) -> Option<String> {
    let url = url.trim();
    let authority = if let Some((scheme, rest)) = url.split_once("://") {
        if scheme.eq_ignore_ascii_case("file") {
            return None;
        }
        rest.split(['/', '?', '#']).next().unwrap_or("")
    } else {
        // scp-style: the first `:` must come before any `/`.
        let colon = url.find(':')?;
        if url[..colon].contains('/') {
            return None;
        }
        &url[..colon]
    };
    let hostport = authority.rsplit('@').next().unwrap_or(authority);
    let host = if let Some(rest) = hostport.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        hostport.split(':').next().unwrap_or("")
    };
    // A single letter is a Windows drive (`C:\repo`), not a host.
    if host.len() < 2 {
        return None;
    }
    Some(host.to_ascii_lowercase())
}

pub fn detect_provider(url: &str) -> RemoteProvider {
    let Some(host) = host_of(url) else {
        return RemoteProvider::Other;
    };
    let host = host.as_str();
    if host == "github.com" || host == "ssh.github.com" || host == "www.github.com" {
        RemoteProvider::GitHub
    } else if host == "gitlab.com" || host.starts_with("gitlab.") {
        RemoteProvider::GitLab
    } else if host == "bitbucket.org" || host == "www.bitbucket.org" {
        RemoteProvider::Bitbucket
    } else if host == "dev.azure.com"
        || host == "ssh.dev.azure.com"
        || host == "visualstudio.com"
        || host.ends_with(".visualstudio.com")
    {
        RemoteProvider::AzureDevOps
    } else {
        RemoteProvider::Other
    }
}
