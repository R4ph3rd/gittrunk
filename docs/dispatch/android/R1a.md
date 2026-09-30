# R1a: native (libgit2) network layer for embedded builds

- Wave: 1 (parallel with UI-D, R2, R1b-1, C1)
- Agent: `rust-git-agent`, model **sonnet**
- Branch/worktree: `feat/android-r1a-native-net`
- Read first: `docs/dispatch/android/COMMON.md`, `docs/PLAN.md` §11, `docs/ANDROID_PLAN.md` §1.2 (all), §1.4 first table (for the pull merge step), §5; `src-tauri/src/platform.rs`, `src-tauri/src/ipc/{types,error}.rs` (merged R0).

## Goal

On embedded builds (`cfg(embedded_git)`: Android, or host `--features embedded-git`), clone, fetch, pull, push and delete-remote-branch run through libgit2 with HTTPS token credentials served by the existing keychain + `CredentialRequested` prompt flow, reporting progress and honoring cancel exactly like the CLI path. The desktop CLI path and every public signature in `net.rs` stay byte-for-byte unchanged.

## Owned files

Create: `src-tauri/src/git/remote/native.rs` (and `native_tests.rs` if you prefer a separate test module).
Modify: `src-tauri/src/git/remote/{net.rs, ops.rs, creds.rs, validate.rs, mod.rs, tests.rs}`, `src-tauri/src/commands/remotes.rs` (only if needed).

Must NOT touch: `git/remote/keychain.rs` (R2), `git/cli/**` (R1b-1), `lib.rs`, `platform.rs`, `ipc/**`, `Cargo.toml`, `commands/repo.rs`.

## Contracts

- `net.rs`: each of `fetch`, `pull`, `push`, `clone`, `delete_remote_branch` first does `if native::enabled() { return native::<op>(...); }` (for `pull`, only the network part moves; see below). `native::enabled() -> bool { cfg!(embedded_git) }`. All `*_args` builders, `classify_failure`, `run_dir`, `clone_target` unchanged.
- `NetSession` gains `resolver: Option<Arc<CredentialResolver>>`; `NetSession::new`/`plain` keep their signatures (resolver `None`); add a `with_resolver` builder or field setter.
- `creds.rs`: extract the body of `resolve_prompt` into

  ```rust
  pub struct CredentialResolver { /* secrets: Arc<dyn SecretStore>, pending: PendingCredentials, notifier, timeout, last_username */ }
  impl CredentialResolver {
      pub fn new(secrets: Arc<dyn SecretStore>, pending: PendingCredentials, notifier: Notifier, timeout: Duration) -> Self;
      /// Same semantics as today's askpass prompt: keychain first, then UI via CredentialRequested.
      pub fn ask(&self, kind: CredentialKind, host: &str, url: &str, username: Option<&str>) -> Option<String>;
      pub fn forget(&self, host: &str, username: &str);   // drop a rejected stored secret
  }
  ```

  The desktop bridge calls it; its behavior and tests are unchanged. Remember/`remember` handling stays where it is today.

- `ops.rs`: `spawn_op` / `sync_session` build a `CredentialBridge` on desktop (as today) and a `CredentialResolver` when `native::enabled()`. Never start `CredentialBridge` on embedded builds.
- Native pull: native fetch of the resolved remote/branch (explicit, else current branch upstream, else `origin` + current branch name), then the merge step through the shim via `sess.run(dir, args)` using exactly this dialect (R1b-1 implements it, R1b-2 implements rebase):
  - Merge: `["merge", "--no-edit", "-m", "Merge branch '<branch>' of <url>", "<oid>"]`
  - FfOnly: `["merge", "--no-edit", "--ff-only", "<oid>"]`
  - Rebase: `["rebase", "<oid>"]`
    Keep the existing `Oplog::record` wrapper and conflict detection (`conflicted_files`) in `pull()`; up-to-date => success with no merge call.
- Credentials callback: only `USER_PASS_PLAINTEXT`. Attempt 1: stored secret (username from URL, else `keychain` `<host>|` last username). After a rejection: `forget`, then prompt username (if unknown) and password/token via the resolver. Fail with `AuthFailed` after 3 attempts. SSH key/agent requests => `ErrorKind::Unsupported` "SSH remotes are not supported on this platform; use an HTTPS URL with a personal access token".
- Progress: map `transfer_progress`, `sideband_progress`, `pack_progress`, `push_transfer_progress` to the existing `Progress { phase, percent, message }` so `Throttle`/`OpProgress` are untouched. Cancellation: return `false` from progress callbacks when the op is cancelled; map the resulting user-abort error to `ErrorKind::Cancelled`.
- Errors: `pub fn classify_git2_error(e: &git2::Error) -> ErrorKind` (`Auth` => `AuthFailed`; net/http/ssl class or resolve/connection/timeout messages => `Network`, certificate text into `detail`; user abort => `Cancelled`; else `GitCli`).
- Push: default refspec = current branch; `tags` adds `refs/tags/*:refs/tags/*`; `force_with_lease` compares the remote's advertised oid (connect + list) with local `refs/remotes/<remote>/<branch>` and fails with "stale info" on mismatch, else pushes `+refspec`; rejections from `push_update_reference` become an error; `set_upstream` via `Branch::set_upstream` after success; update remote-tracking refs after a successful push.
- Clone: `RepoBuilder` with fetch options and `bare`; keep the existing destination cleanup on failure; `recurse_submodules` best effort via `Submodule::update(true, ..)` with the same fetch options.
- `validate.rs::url` under embedded: accept `https://` only; also `http://`, `file://` and absolute local paths under `cfg(test)` only; reject `ssh://` and `user@host:path` with the HTTPS + token message.

## Tests (host, `--features embedded-git`)

Against local bare remotes (`file://` / local paths created with the real `git` binary in temp dirs): fetch (single remote, all remotes, prune, tags), pull merge / ff-only / up-to-date / conflict (`OpOutcome::Conflicted`), push (new branch with upstream, non-ff rejection surfaces an error, force-with-lease stale vs fresh, tags), clone (normal, bare, destination cleanup on failure), delete remote branch, cancellation (cancel before transfer => `Cancelled`), `classify_git2_error`, `CredentialResolver` with a fake `SecretStore` and fake notifier (stored secret used first; rejection forgets and prompts; 3 failures => `AuthFailed`), URL validation. Pull with `Rebase` depends on R1b-2: gate that test `#[cfg(not(embedded_git))]` or assert `Unsupported` for now, with a `// R1b-2:` comment. Existing tests that only make sense for the CLI/askpass path get `#[cfg(not(embedded_git))]` (annotation only; never change their assertions).

Note: until R1b-1 merges, the pull merge step runs the real `git merge` on the host, which is fine for your tests.

## Steps and commits

1. `CredentialResolver` extraction (desktop tests green) => `refactor(remote): extract credential resolver from the askpass bridge`.
2. `native.rs` fetch/clone/push/delete + dispatch + validation => `feat(remote): add libgit2 network backend for embedded builds`.
3. Native pull + tests => `feat(remote): pull through the embedded backend`.

## Prove it

```bash
cd <worktree>/src-tauri && export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/home/user/gittrunk/src-tauri/target
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo clippy --all-targets --features embedded-git -- -D warnings
cargo test
cargo test --features embedded-git -- git::remote
```

## Acceptance criteria

- Desktop: no behavior change; all existing remote tests pass unchanged.
- Embedded: all tests listed above pass; no `CredentialBridge`/`current_exe` use on embedded code paths (grep evidence).
- `NetSession::new`/`plain` and all `net.rs` public functions keep their signatures.
- Pull dialect exactly as specified (R1b-1 and R1b-2 rely on it).

## Out of scope / needs orchestrator

The reqwest-backed smart-HTTP fallback transport (only if the CI OpenSSL build fails; the checker decides), SSH, UI.
