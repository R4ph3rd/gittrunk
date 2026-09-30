# R-FORGE: GitHub issues and comments backend

- Wave: 1
- Agent: `rust-git-agent`, model **sonnet**
- Branch/worktree: `feat/forge-github`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.2 (Forge), merged contract: `src-tauri/src/ipc/types.rs` (forge types), `src-tauri/src/commands/forge.rs` (stubs), `src-tauri/src/http.rs`; patterns: `src-tauri/src/ai/provider.rs` (boxed-future trait), `src-tauri/src/ai/settings.rs` (keyring vs file store under `cfg(embedded_git)`), `src-tauri/src/secrets.rs`, `src-tauri/src/git/remote/{keychain.rs,provider.rs}`.
- Rust only.

## Goal

A GitHub REST client behind a `Forge` trait, forge detection from the repository's remotes, secure token storage with a fallback to the remembered git credential, and the ten forge commands.

## Owned files

Create/modify: `src-tauri/src/forge/**` (`mod.rs`, `github.rs`, `remote.rs`, `tokens.rs`, `time.rs`, `tests.rs`, ... as you see fit), `src-tauri/src/commands/forge.rs` (bodies only).
Must NOT touch: command signatures, `ipc/**`, `lib.rs`, `http.rs`, `secrets.rs`, `git/remote/**`, `Cargo.toml`, anything in `src/`. Implementing a trait of yours for `crate::secrets::FileStore` inside `forge/tokens.rs` is fine.

## Design

```rust
pub trait Forge: Send + Sync {
    fn list_issues<'a>(&'a self, q: &'a IssueQuery) -> BoxFuture<'a, AppResult<IssuePage>>;
    fn issue<'a>(&'a self, number: u32) -> BoxFuture<'a, AppResult<IssueDetail>>;
    fn create_issue<'a>(&'a self, req: &'a IssueCreateRequest) -> BoxFuture<'a, AppResult<Issue>>;
    fn comment_issue<'a>(&'a self, number: u32, body: &'a str) -> BoxFuture<'a, AppResult<ForgeComment>>;
    fn commit_comments<'a>(&'a self, oid: &'a str) -> BoxFuture<'a, AppResult<Vec<ForgeComment>>>;
    fn comment_commit<'a>(&'a self, oid: &'a str, body: &'a str) -> BoxFuture<'a, AppResult<ForgeComment>>;
}
pub struct GithubForge { client: reqwest::Client, api: String /* https://api.github.com */, owner: String, name: String, token: Option<String> }
```

- Detection (`remote.rs`, pure): parse `https://[user[:pw]@]github.com/<owner>/<name>[.git][/]`, `git@github.com:<owner>/<name>[.git]`, `ssh://git@github.com[:port]/<owner>/<name>[.git]`; host via `git::remote::provider::host_of`. Prefer the `origin` remote, else the first remote whose host is `github.com`, else the first GitLab remote (reported with `supported: false`). Credentials embedded in a URL are never copied into `ForgeRepo` (`remote` holds the remote name, `web_url` is rebuilt as `https://<host>/<owner>/<name>`). Owner/name validated as `[A-Za-z0-9._-]+`.
- Tokens (`tokens.rs`): store service `gittrunk-forge`, account = host, in the OS keychain (`keyring`) on desktop and in `crate::secrets::global()` (file store) under `cfg(embedded_git)`; follow the `ai/settings.rs` cfg pattern and keep a `ForgeTokens` trait so tests use an in-memory fake. Resolution: forge token -> the remembered HTTPS credential for the host (`git::remote::keychain::Keychain`: username from account `<host>|`, then its secret) -> none; reported as `ForgeTokenSource::{Forge, GitCredential, None}`.
- `forge_token_set(host, token)`: host must be `github.com` (else `Unsupported`); trim; reject empty or whitespace-containing tokens (`InvalidInput`); call `GET {api}/user` with it; 401 -> `AuthFailed` "GitHub rejected the token" and nothing stored; success stores it and returns `ForgeUser { login }`.
- HTTP: `crate::http::client(Duration::from_secs(20))`; headers `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `Authorization: Bearer <token>` when present. Endpoints:
  - issues: `GET /repos/{o}/{n}/issues?state=<open|closed|all>&per_page=<1..=100>&page=<n>&sort=updated`; drop items with a `pull_request` key; `next_page` from the `Link` header `rel="next"` `page=` parameter.
  - issue: `GET /repos/{o}/{n}/issues/{number}` (a pull request number -> `InvalidInput` "#N is a pull request") + `GET .../issues/{number}/comments?per_page=100` (follow `next` up to 10 pages).
  - create: `POST /repos/{o}/{n}/issues {title, body}`; comment: `POST .../issues/{number}/comments {body}`.
  - commit comments: `GET /repos/{o}/{n}/commits/{sha}/comments?per_page=100`; `POST` same path `{body}`. Oid must be 40 hex chars.
- Mapping: RFC 3339 timestamps -> unix seconds `f64` (`time` crate, `Rfc3339`); ids -> strings; `user.login` -> `ForgeUser`; `labels[].name`; `html_url` -> `url`; `null` body -> `""`.
- Validation before any request: title 1..=256 chars after trim; bodies ≤ 65 536 chars; comment bodies non-empty after trim; writes without a token -> `AuthRequired` "Add a GitHub token in Settings > Integrations".
- Errors (never include the token or the Authorization header; include GitHub's `message` field when present): 401 -> `AuthFailed`; 403 with `x-ratelimit-remaining: 0` -> `Network` "GitHub rate limit reached; resets at HH:MM" (+ "add a token for a higher limit" when anonymous); other 403 -> `AuthRequired` "The token cannot access this repository"; 404 without token -> `AuthRequired` "Repository not found or private: add a GitHub token"; 404 with token -> `InvalidInput` "Not found on GitHub"; 410 -> `Unsupported` "Issues are disabled for this repository"; 422 on commit endpoints -> `InvalidInput` "This commit is not on GitHub"; other 422 -> `InvalidInput` with GitHub's message; transport errors -> `Network` (scrubbed like `ai::provider::scrub`).
- Commands: `forge_status` reads remotes with `GitState::with_repo` inside `blocking`, then resolves the token source (no network). Other repo commands: resolve repo (not GitHub -> `Unsupported` "Issues need a GitHub remote"), build `GithubForge`, await. `forge_token_source`/`forge_token_clear` need no repo.

## Tests (`mockito`, in-memory token store, fixture repos from `git::fixtures` for remote detection)

URL parsing table (all three forms, `.git` suffix, trailing slash, embedded credentials not leaked, GitLab detected, local path none); remote preference (origin over others); token precedence (forge > git credential > none); token set validates via `/user` (200 stores, 401 does not); list issues filters pull requests and parses `Link`; issue detail merges comments across two pages; create/comment send the right JSON and auth header; anonymous write -> `AuthRequired` with no request (`expect(0)`); each error mapping above; timestamps parsed; the token never appears in any error `message`/`detail` (assert on a sentinel token string).

## Prove it

```bash
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/home/user/gittrunk/src-tauri/target
cd <worktree>/src-tauri && cargo fmt --all --check && cargo clippy --all-targets -- -D warnings \
  && cargo clippy --all-targets --features embedded-git -- -D warnings \
  && cargo test forge && cargo test && cargo test --features embedded-git
cd .. && pnpm install --frozen-lockfile && pnpm bindings && git diff --exit-code src/ipc/bindings.ts
```

## Acceptance criteria

- All tests green with and without `embedded-git`; bindings unchanged; no new dependencies.
- No `println!`/`eprintln!`/`log` of tokens, headers or request URLs with credentials; grep proves it.
- Writes are impossible without a token and never reach the network.

## Commits

`feat(forge): detect GitHub repositories from remotes`, `feat(forge): store forge tokens with a git credential fallback`, `feat(forge): list, read, create and comment on GitHub issues`, `feat(forge): read and add commit comments`.

## Out of scope / needs orchestrator

GitLab client, GitHub Enterprise hosts, pull requests, editing/closing issues, caching (the frontend caches).
