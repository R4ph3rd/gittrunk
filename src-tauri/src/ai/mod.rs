//! AI assistance: provider abstraction (Anthropic default, OpenAI-compatible),
//! prompts, payload previews and plan validation. Owned by `ai-agent`.
//!
//! Privacy invariant: no provider client exists unless `AiSettings.enabled`
//! is true (`service::require_enabled` runs before `provider::create`).

pub mod anthropic;
pub mod openai_compat;
pub mod payload;
pub mod plan;
pub mod provider;
pub mod service;
pub mod settings;
