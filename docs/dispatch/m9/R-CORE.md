# R-CORE: avatar service, oplog state and redo ordering

- Wave: 1
- Agent: `rust-git-agent`, model **sonnet**
- Branch/worktree: `feat/avatars-oplog-state`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.2 (Avatars), merged contract: `src-tauri/src/ipc/types.rs` (`AvatarSubject`, `AvatarMode`, `AppSettings.avatars`, `OplogState`), `src-tauri/src/http.rs`, `src-tauri/src/commands/{avatars.rs,oplog.rs,settings.rs}`, `src-tauri/src/settings/mod.rs`, `src-tauri/src/git/oplog/{mod.rs,tests.rs}`.
- Rust only; no frontend changes.

## Goal

Implement `avatars_get` (backend-fetched, cached avatars as `data:` URLs honoring the avatar setting), implement `oplog_state`, and fix redo ordering so multi-step undo/redo walks the journal in the right order.

## Owned files

Modify: `src-tauri/src/avatars/**` (replace the placeholder; add `sources.rs`, `cache.rs`, `tests.rs` as you see fit), `src-tauri/src/commands/avatars.rs` (body only), `src-tauri/src/commands/oplog.rs` (`oplog_state` body only), `src-tauri/src/git/oplog/{mod.rs,tests.rs}`.
Must NOT touch: command signatures, `ipc/**`, `lib.rs`, `http.rs`, `Cargo.toml`, `settings/**`, anything in `src/`.

## Avatars

Behavior of `avatars_get(subjects, size)`:

- Output has the same length and order as `subjects`; each entry is `Some("data:<content-type>;base64,<...>")` or `None`. More than 200 subjects: `InvalidInput`. `size` clamped to 16..=256.
- Mode from `settings::load(app_config_dir)` (`AppSettings.avatars`):
  - `Off`: all `None`, no network, no disk access.
  - `Github`: GitHub sources only.
  - `GithubAndGravatar`: GitHub sources, then Gravatar for any other email.
- Sources (base URLs injectable for tests through a `Sources { github_avatars, github_web, gravatar }` struct with production defaults `https://avatars.githubusercontent.com`, `https://github.com`, `https://www.gravatar.com`):
  - `<digits>+<login>@users.noreply.github.com` -> `{github_avatars}/u/<digits>?s=<size>&v=4`
  - `<login>@users.noreply.github.com` -> `{github_web}/<login>.png?size=<size>` (redirect followed)
  - `GithubLogin { login }` -> `{github_web}/<login>.png?size=<size>`
  - other email (Gravatar mode) -> `{gravatar}/avatar/<sha256 hex of trimmed lower-case email>?s=<size>&d=404`
  - Logins must match `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$` (a `[bot]` suffix or anything else: `None`, no request). Emails must contain one `@` and be at most 254 bytes.
- A response counts as an avatar only with status 200, a `content-type` starting with `image/` and a body of at most 256 KiB. 404 (and other 4xx) is a cached miss. Network errors, timeouts and 5xx are `None` for this call and are not written to disk.
- Cache: key = `avatarKey` form (`email:<lower>` / `github:<lower>`) + size. Memory map in `AvatarCache` (a `parking_lot::Mutex<HashMap<..>>`); disk under `app_cache_dir()/avatars/<sha256(key|size)>` holding the data URL text, or an empty file for a miss. Hits are fresh for 7 days, misses for 1 day (file mtime). Unreadable cache dirs degrade to memory-only.
- Concurrency: at most 6 requests in flight (`tokio::sync::Semaphore`), duplicate keys in one call fetched once; per-request timeout 8 s (`crate::http::client`).
- Never log emails, hashes or URLs.

Structure it so the core is testable without Tauri, e.g. `AvatarCache::get_many(&self, http: &reqwest::Client, dir: Option<&Path>, mode: AvatarMode, sources: &Sources, subjects: &[AvatarSubject], size: u32) -> Vec<Option<String>>`; the command resolves `app_config_dir` / `app_cache_dir` and calls it.

Tests (`mockito`, temp dirs): each URL form (noreply with id, noreply login, login subject, Gravatar hash for `"  Dev@Example.COM "` equals the SHA-256 of `dev@example.com`); `Off` makes no request (mock with `expect(0)`); `Github` mode never calls the Gravatar mock; 404 cached as a miss on disk and not re-requested within a second call; 500 not cached; non-image content type rejected; oversized body rejected; duplicate subjects -> one request; invalid login -> `None` without a request; expired disk entry refetched (set mtime back with `filetime`-free approach: write the file then call an internal `is_fresh(path, now + 8 days)` helper instead of touching mtimes).

## Oplog state and redo fix

Current bug: `Oplog::step` picks the _last_ undone entry for redo (`rposition(|e| e.undone && !e.superseded)`). After two undos (entries B then A reverted) redo applies B's `before -> after` while the repo is at A's `before`, and a second redo moves backwards. Fix: redo reapplies the **oldest** undone, non-superseded entry that comes after the newest not-undone entry (entries after the last applied one form the undone tail; take its first element). Undo is unchanged.

`Oplog::state(repo) -> AppResult<OplogState>` uses the same selection: `can_undo`/`undo_description` from the entry undo would take, `can_redo`/`redo_description` from the entry redo would take; a missing journal = all false/None. `oplog_state` command: `with_repo` + `blocking`, like `oplog_list`.

Tests in `git/oplog/tests.rs`: two operations (e.g. create branch `a`, then `b`), undo twice, redo once -> only `a` exists, redo again -> both exist, state after each step (flags and descriptions); a new operation after an undo clears `can_redo`; empty repo state all false.

## Prove it

```bash
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/home/user/gittrunk/src-tauri/target
cd <worktree>/src-tauri && cargo fmt --all --check && cargo clippy --all-targets -- -D warnings \
  && cargo clippy --all-targets --features embedded-git -- -D warnings \
  && cargo test avatars && cargo test oplog && cargo test && cargo test --features embedded-git
cd .. && pnpm install --frozen-lockfile && pnpm bindings && git diff --exit-code src/ipc/bindings.ts
```

## Acceptance criteria

- All tests above green; bindings unchanged; no new dependencies.
- `avatars_get` makes no network or disk access with `AvatarMode::Off`.
- Multi-step undo/redo returns to the original state in order.

## Commits

`feat(avatars): fetch and cache avatars from GitHub and Gravatar in the backend`, `fix(oplog): redo the oldest undone operation first`, `feat(oplog): report undo and redo availability`.

## Out of scope / needs orchestrator

Any UI. If `app_cache_dir` is unavailable on a platform, fall back to memory-only and note it.
