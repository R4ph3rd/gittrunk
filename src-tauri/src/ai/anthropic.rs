//! Anthropic Messages API (`POST {base}/v1/messages`).
//!
//! Auth is the `x-api-key` header; `anthropic-version: 2023-06-01` is the
//! stable API version header. No extended thinking is requested: these are
//! short, one-shot text generations, and the default model
//! (`claude-haiku-4-5`) takes no thinking parameters.

use serde_json::{json, Value};

use crate::ipc::error::{AppError, AppResult, ErrorKind};

use super::provider::{http_error, provider_error, scrub, BoxFuture, ChatMessage, Provider};

pub const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";
pub const API_VERSION: &str = "2023-06-01";
const NAME: &str = "Anthropic";

pub struct AnthropicProvider {
    client: reqwest::Client,
    url: String,
    model: String,
    key: String,
}

impl AnthropicProvider {
    pub fn new(
        client: reqwest::Client,
        base_url: Option<String>,
        model: String,
        key: Option<String>,
    ) -> AppResult<Self> {
        let key = key.filter(|k| !k.trim().is_empty()).ok_or_else(|| {
            AppError::new(ErrorKind::AiDisabled, "No Anthropic API key is configured")
        })?;
        let base = base_url
            .as_deref()
            .map(str::trim)
            .filter(|b| !b.is_empty())
            .unwrap_or(DEFAULT_BASE_URL)
            .trim_end_matches('/')
            .to_string();
        let url = if base.ends_with("/v1") {
            format!("{base}/messages")
        } else {
            format!("{base}/v1/messages")
        };
        Ok(Self {
            client,
            url,
            model,
            key,
        })
    }

    pub fn request_body(
        model: &str,
        system: &str,
        messages: &[ChatMessage],
        max_tokens: u32,
    ) -> Value {
        json!({
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages
                .iter()
                .map(|m| json!({"role": m.role.as_str(), "content": m.content}))
                .collect::<Vec<_>>(),
        })
    }

    /// Concatenates the text blocks of a Messages API response.
    pub fn parse_response(body: &str) -> AppResult<String> {
        let v: Value = serde_json::from_str(body)
            .map_err(|_| provider_error(NAME, "the response was not valid JSON"))?;
        if v.get("stop_reason").and_then(Value::as_str) == Some("refusal") {
            return Err(provider_error(NAME, "the model declined this request"));
        }
        let text: String = v
            .get("content")
            .and_then(Value::as_array)
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|b| b.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();
        if text.trim().is_empty() {
            return Err(provider_error(NAME, "the response contained no text"));
        }
        Ok(text)
    }
}

impl Provider for AnthropicProvider {
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
            let resp = self
                .client
                .post(&self.url)
                .header("x-api-key", &self.key)
                .header("anthropic-version", API_VERSION)
                .json(&body)
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
