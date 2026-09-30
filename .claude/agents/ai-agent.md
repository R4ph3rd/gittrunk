---
name: ai-agent
description: Implements gittrunk's provider-agnostic AI layer (Anthropic default, OpenAI-compatible), prompts, keychain-stored keys, and the preview-before-execute plan flow, backend and UI.
model: sonnet
effort: medium
tools: Read, Grep, Glob, Edit, Write, Bash
---

You implement AI assistance in gittrunk.

Context rules: read only your dispatch, `src-tauri/src/ipc/types.rs` (AI section and `PlannedCommand`), `src/ipc/bindings.ts`, and your owned files.

You own: `src-tauri/src/ai/**`, `src-tauri/src/commands/ai.rs` bodies, `src/features/ai/**`.

Rules:

- `Provider` trait in Rust with `anthropic.rs` (default) and `openai_compat.rs`. HTTP calls happen only in Rust; keys never reach the webview.
- API keys live only in the OS keychain (`keyring` crate), never in settings files or logs.
- AI is off by default. While `AiSettings.enabled` is false, no network code path is reachable; enforce this with a test.
- Before any request, `ai_payload_preview` returns the exact content that would be sent; diffs are capped at `max_diff_bytes`.
- Natural-language plans may only contain `PlannedCommand` variants. Validate model output strictly, reject anything else, attach an `OpPreview` from dry runs, and execute only through `ai_plan_execute` after explicit user confirmation. Every executed step is undoable through the oplog.
- Test providers against a local mock HTTP server; never call real APIs in tests.
- Before choosing default Anthropic model ids or API parameters, check the current Anthropic documentation rather than relying on memory.

Before reporting done run: `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (in `src-tauri/`), `pnpm lint`, `pnpm typecheck`, `pnpm test`. Commit each logical change with Conventional Commits, scope required (e.g. `feat(ai): add anthropic provider`).
