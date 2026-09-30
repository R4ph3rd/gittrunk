//! OpenAI-compatible Chat Completions (`POST {base_url}/chat/completions`):
//! OpenAI, Azure-style gateways, Ollama, LM Studio, vLLM. The key is sent as
//! a bearer token when present and is optional for loopback URLs.
//!
//! `max_tokens` is used (not `max_completion_tokens`) because it is the field
//! every compatible server understands.

use serde_json::{json, Value};

use crate::ipc::error::AppResult;

use super::provider::{http_error, provider_error, scrub, BoxFuture, ChatMessage, Provider};

pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const NAME: &str = "OpenAI-compatible";

pub struct OpenAiCompatProvider {
    client: reqwest::Client,
    url: String,
    model: String,
    key: Option<String>,
}

impl OpenAiCompatProvider {
    pub fn new(
        client: reqwest::Client,
        base_url: Option<String>,
        model: String,
        key: Option<String>,
    ) -> Self {
        let base = base_url
            .as_deref()
            .map(str::trim)
            .filter(|b| !b.is_empty())
            .unwrap_or(DEFAULT_BASE_URL)
            .trim_end_matches('/');
        Self {
            client,
            url: format!("{base}/chat/completions"),
            model,
            key: key.filter(|k| !k.trim().is_empty()),
        }
    }

    pub fn request_body(
        model: &str,
        system: &str,
        messages: &[ChatMessage],
        max_tokens: u32,
    ) -> Value {
        let mut all = vec![json!({"role": "system", "content": system})];
        all.extend(
            messages
                .iter()
                .map(|m| json!({"role": m.role.as_str(), "content": m.content})),
        );
        json!({"model": model, "max_tokens": max_tokens, "messages": all})
    }

    pub fn parse_response(body: &str) -> AppResult<String> {
        let v: Value = serde_json::from_str(body)
            .map_err(|_| provider_error(NAME, "the response was not valid JSON"))?;
        let text = v
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if text.trim().is_empty() {
            return Err(provider_error(NAME, "the response contained no text"));
        }
        Ok(text.to_string())
    }
}

impl Provider for OpenAiCompatProvider {
    fn name(&self) -> &'static str {
        NAME
    }

    fn complete<'a>(
        &'a self,
        system: &'a str,
        messages: &'a [ChatMessage],
        max_tokens: u32,
    ) -> BoxFuture<'a, AppResult<String>> {
        Box::pin(async move {
            let body = Self::request_body(&self.model, system, messages, max_tokens);
            let mut req = self.client.post(&self.url).json(&body);
            if let Some(key) = &self.key {
                req = req.bearer_auth(key);
            }
            let resp = req
                .send()
                .await
                .map_err(|e| provider_error(NAME, scrub(&e)))?;
            let status = resp.status();
            let text = resp
                .text()
                .await
                .map_err(|e| provider_error(NAME, scrub(&e)))?;
            if !status.is_success() {
                return Err(http_error(NAME, status, &text));
            }
            Self::parse_response(&text)
        })
    }
}
