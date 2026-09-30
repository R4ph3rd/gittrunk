//! Orchestration behind the `ai_*` commands: enforcement, payload building,
//! provider call and response post-processing. Kept free of Tauri types so
//! it can be tested against a mock HTTP server.

use std::path::Path;

use crate::git::{blocking, GitState};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

use super::payload::{self, Payload};
use super::plan;
use super::provider::{self, is_local_url, ChatMessage};
use super::settings::{self, KeyStore};

/// Fails with `AiDisabled` unless AI is enabled. Runs before anything that
/// could build a client or read repository content for AI.
pub fn require_enabled(settings: &AiSettings) -> AppResult<()> {
    if settings.enabled {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorKind::AiDisabled,
            "AI assistance is turned off. Enable it in AI settings.",
        ))
    }
}

/// Loads settings and requires them to be enabled.
pub fn enabled_settings(dir: &Path, keys: &dyn KeyStore) -> AppResult<AiSettings> {
    let s = settings::load(dir, keys);
    require_enabled(&s)?;
    Ok(s)
}

fn max_bytes(s: &AiSettings) -> usize {
    s.max_diff_bytes as usize
}

pub async fn payload_preview(
    state: &GitState,
    dir: &Path,
    keys: &dyn KeyStore,
    repo: &str,
    request: &AiRequest,
) -> AppResult<AiPayloadPreview> {
    let s = enabled_settings(dir, keys)?;
    Ok(build_payload(state, repo, request, &s).await?.preview())
}

async fn build_payload(
    state: &GitState,
    repo: &str,
    request: &AiRequest,
    s: &AiSettings,
) -> AppResult<Payload> {
    let st = state.clone();
    let repo = repo.to_string();
    let request = request.clone();
    let max = max_bytes(s);
    blocking(move || st.with_repo(&repo, |_, r| payload::build(r, &request, max))).await
}

/// Strips a wrapping code fence from a reply that should be plain text.
fn clean_text(text: &str) -> String {
    plan::strip_fences(text).trim().to_string()
}

pub async fn run(
    state: &GitState,
    dir: &Path,
    keys: &dyn KeyStore,
    repo: &str,
    request: &AiRequest,
) -> AppResult<AiResponse> {
    let s = enabled_settings(dir, keys)?;
    let key = keys.get(s.provider);
    if key.is_none()
        && !(s.provider == AiProviderKind::OpenAiCompatible
            && s.base_url.as_deref().is_some_and(is_local_url))
    {
        return Err(AppError::new(
            ErrorKind::AiDisabled,
            "AI is enabled but no API key is configured. Add one in AI settings.",
        ));
    }
    let payload = build_payload(state, repo, request, &s).await?;
    let provider = provider::create(&s, key)?;
    let messages = [ChatMessage::user(payload.content.clone())];
    let reply = provider
        .complete(payload.system, &messages, payload.max_tokens)
        .await?;

    if let AiRequest::Plan { prompt } = request {
        let parsed = plan::parse(&reply)?;
        let st = state.clone();
        let repo_id = repo.to_string();
        let prompt = prompt.trim().to_string();
        return blocking(move || {
            st.with_repo(&repo_id, |_, r| plan::validate(r, &parsed.steps))?;
            let preview = plan::preview(&st, &repo_id, &parsed.steps)?;
            let id = plan::remember(&repo_id, parsed.steps.clone());
            Ok(AiResponse::Plan {
                plan: AiPlan {
                    id,
                    prompt,
                    explanation: parsed.explanation,
                    steps: parsed.steps,
                    preview,
                },
            })
        })
        .await;
    }

    let text = clean_text(&reply);
    if text.is_empty() {
        return Err(AppError::new(
            ErrorKind::AiProvider,
            format!("{}: the response was empty", provider.name()),
        ));
    }
    Ok(AiResponse::Text { text })
}

#[cfg(test)]
mod tests;
