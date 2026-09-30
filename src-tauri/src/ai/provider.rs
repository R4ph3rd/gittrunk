//! Provider abstraction. HTTP happens only here (and in the two provider
//! modules), and a client is only ever built after the caller has checked
//! `AiSettings.enabled`. Nothing in this module logs: request bodies contain
//! repository content and headers contain keys.

use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;
use std::time::Duration;

use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::{AiProviderKind, AiSettings};

use super::anthropic::AnthropicProvider;
use super::openai_compat::OpenAiCompatProvider;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

impl ChatMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
        }
    }
}

/// A text-completion backend. Streaming is intentionally not part of the
/// trait: every gittrunk action is a short, one-shot generation.
pub trait Provider: Send + Sync {
    fn name(&self) -> &'static str;

    fn complete<'a>(
        &'a self,
        system: &'a str,
        messages: &'a [ChatMessage],
        max_tokens: u32,
    ) -> BoxFuture<'a, AppResult<String>>;
}

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

/// Keychain account name / display name for a provider.
pub fn provider_name(kind: AiProviderKind) -> &'static str {
    match kind {
        AiProviderKind::Anthropic => "anthropic",
        AiProviderKind::OpenAiCompatible => "openai-compatible",
    }
}

/// Builds the HTTP client. The rustls crypto provider is installed once.
pub fn build_client() -> AppResult<reqwest::Client> {
    static PROVIDER: OnceLock<()> = OnceLock::new();
    PROVIDER.get_or_init(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    let builder = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT);
    // Embedded builds must never construct rustls-platform-verifier (it needs
    // JVM initialisation on Android): verify against the bundled Mozilla roots.
    #[cfg(embedded_git)]
    let builder = {
        let roots = rustls::RootCertStore {
            roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
        };
        let tls = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        builder.use_preconfigured_tls(tls)
    };
    builder.build().map_err(|e| {
        AppError::new(
            ErrorKind::AiProvider,
            format!("could not create HTTP client: {}", scrub(&e)),
        )
    })
}

/// Constructs the provider for `settings`. Callers must have verified that
/// AI is enabled; this is the only place clients are created.
pub fn create(settings: &AiSettings, key: Option<String>) -> AppResult<Box<dyn Provider>> {
    let client = build_client()?;
    Ok(match settings.provider {
        AiProviderKind::Anthropic => Box::new(AnthropicProvider::new(
            client,
            settings.base_url.clone(),
            settings.model.clone(),
            key,
        )?),
        AiProviderKind::OpenAiCompatible => Box::new(OpenAiCompatProvider::new(
            client,
            settings.base_url.clone(),
            settings.model.clone(),
            key,
        )),
    })
}

/// True for loopback hosts, where an API key is optional (Ollama, LM Studio).
pub fn is_local_url(url: &str) -> bool {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
        .is_some_and(|h| {
            matches!(h.as_str(), "localhost" | "127.0.0.1" | "::1" | "[::1]")
                || h.ends_with(".localhost")
        })
}

pub fn provider_error(provider: &str, message: impl AsRef<str>) -> AppError {
    AppError::new(
        ErrorKind::AiProvider,
        format!("{provider}: {}", clip(message.as_ref(), 400)),
    )
}

/// A reqwest error without its URL (URLs may carry credentials).
pub fn scrub(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "the request timed out".to_string()
    } else if e.is_connect() {
        "could not connect".to_string()
    } else if e.is_decode() {
        "the response could not be read".to_string()
    } else {
        "the request failed".to_string()
    }
}

pub fn clip(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{cut}...")
}

/// Pulls a human message out of `{"error": {"message": ..}}` /
/// `{"error": "..."}` bodies.
pub fn error_message(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let e = v.get("error")?;
    e.get("message")
        .and_then(|m| m.as_str())
        .or_else(|| e.as_str())
        .map(str::to_string)
}

/// Maps a non-success HTTP response to an `AiProvider` error carrying the
/// provider's own message (never the request).
pub fn http_error(provider: &str, status: reqwest::StatusCode, body: &str) -> AppError {
    let msg = error_message(body).unwrap_or_else(|| {
        status
            .canonical_reason()
            .unwrap_or("request failed")
            .to_string()
    });
    let mut err = provider_error(provider, format!("{msg} (HTTP {})", status.as_u16()));
    err.detail = Some(format!("status {}", status.as_u16()));
    err
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_urls() {
        assert!(is_local_url("http://localhost:11434/v1"));
        assert!(is_local_url("http://127.0.0.1:1234"));
        assert!(is_local_url("http://[::1]:8080/v1"));
        assert!(!is_local_url("https://api.openai.com/v1"));
        assert!(!is_local_url("not a url"));
    }

    #[tokio::test]
    async fn client_builds_and_reaches_plain_http() {
        let client = build_client().unwrap();
        let mut server = mockito::Server::new_async().await;
        let m = server
            .mock("GET", "/ping")
            .with_body("pong")
            .create_async()
            .await;
        let body = client
            .get(format!("{}/ping", server.url()))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(body, "pong");
        m.assert_async().await;
    }

    #[test]
    fn extracts_error_messages() {
        assert_eq!(
            error_message(r#"{"error":{"message":"bad key"}}"#).as_deref(),
            Some("bad key")
        );
        assert_eq!(
            error_message(r#"{"error":"nope"}"#).as_deref(),
            Some("nope")
        );
        assert_eq!(error_message("<html>"), None);
    }
}
