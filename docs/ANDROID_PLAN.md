# Android plan

Status: plan (not implemented). Owner: planner. UI adaptation lives in `docs/MOBILE_DESIGN.md` (separate).

Goal: ship a sideloadable Android APK of gittrunk (Tauri 2 mobile) built and proven on GitHub Actions, with desktop behavior unchanged.

Scope of v1: clone, open (app-private repos), browse history/graph/diffs, stage/unstage, commit, branches, stash, merge/cherry-pick/revert/reset, fetch/pull/push over HTTPS with token credentials, AI features. Out of scope for v1: SSH remotes, opening arbitrary folders (SAF/content URIs), interactive rebase, linked worktrees, git hooks, commit signing, Play Store (AAB).

---

## 0. Decisions at a glance

| Topic                                  | Decision                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network without `git` CLI              | libgit2 built-in HTTPS (`git2` features `https` + `vendored-openssl`, Android target only) behind a typed native layer `git/remote/native.rs`. Desktop keeps the CLI path unchanged. Fallback: reqwest-backed custom libgit2 smart transport.                    |
| Everything else that shells out to git | An "embedded git" shim inside `GitCli` (`git/cli/embedded/`) that implements the exact CLI dialect the codebase uses on top of libgit2. One choke point, no call-site churn.                                                                                     |
| Compile-time switch                    | `cfg(embedded_git)`, set by `build.rs` when `target_os = "android"` OR Cargo feature `embedded-git` (host-testable).                                                                                                                                             |
| Secrets                                | `FileStore` in the app-private dir (0600, atomic write), plugged in behind the existing `SecretStore` / `KeyStore` traits. Android Keystore wrapping is a v1.1 seam, not v1. `allowBackup=false`.                                                                |
| Reqwest/AI TLS on Android              | `use_preconfigured_tls` with `webpki-roots` (no JNI). `rustls-platform-verifier` stays uninitialised and unused.                                                                                                                                                 |
| Repo storage                           | `<app_data_dir>/repos/<name>`. Clone is the only way in. `platform_info.defaultReposDir` tells the UI.                                                                                                                                                           |
| Frontend detection                     | New IPC `platform_info` returning capability flags (not `plugin-os`).                                                                                                                                                                                            |
| Android project                        | Commit `src-tauri/gen/android/`, generated once by a manual `android-init.yml` workflow that commits back to the branch, plus an idempotent tracked `scripts/android/customize.mjs`.                                                                             |
| Build                                  | Composite action `.github/actions/build-android` used by `build-android.yml` and `release.yml`. Push/PR builds: `aarch64` + `x86_64`, dev-signed with a throwaway key, thin LTO. Release: universal APK (`aarch64`, `armv7`, `x86_64`), real keystore, full LTO. |
| Release                                | Android job after the `build` matrix (needs the draft to exist), uploads with `gh release upload --clobber`, `publish` waits for it and checks `.apk`.                                                                                                           |
| Local verification                     | host `cargo test/clippy --features embedded-git` runs the whole suite against the embedded backend; `cargo tree --target aarch64-linux-android` proves dependency resolution. Only CI proves the NDK/OpenSSL/Gradle build.                                       |

---

## 1. Backend portability, module by module

### 1.1 cfg strategy

`src-tauri/build.rs` (owner R0):

```rust
fn main() {
    println!("cargo::rustc-check-cfg=cfg(embedded_git)");
    let android = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|v| v == "android");
    if android || std::env::var_os("CARGO_FEATURE_EMBEDDED_GIT").is_some() {
        println!("cargo::rustc-cfg=embedded_git");
    }
    tauri_build::build()
}
```

`Cargo.toml` (owner R0 only; nobody else edits `Cargo.toml` or `Cargo.lock`):

```toml
[features]
default = []
# Host-testable stand-in for the Android backend: libgit2 for all git work,
# file-backed secret store. Never enabled in desktop releases.
embedded-git = []

# was: git2 = { ..., features = ["vendored-libgit2"] } stays as is (all platforms)

[target.'cfg(not(target_os = "android"))'.dependencies]
keyring = { version = "3", features = ["apple-native", "windows-native", "sync-secret-service", "crypto-rust"] }  # moved here

[target.'cfg(target_os = "android")'.dependencies]
# Cargo unifies features per target: only Android gets TLS in libgit2.
git2 = { version = "0.21", default-features = false, features = ["vendored-libgit2", "https", "vendored-openssl"] }
webpki-roots = "1"
```

Facts checked in the registry / `Cargo.lock`:

- `git2 0.21.0`, `libgit2-sys 0.18.8+1.9.7`. `https` pulls `openssl-sys` plus `openssl-probe`, and `vendored-openssl` builds OpenSSL from source via `openssl-src` (needs `perl` and `make`, both on ubuntu runners). `libgit2-sys/build.rs` already special-cases Android (`GIT_USE_NSEC` off) and defines `GIT_OPENSSL` for non-Windows, non-Apple targets.
- `keyring 3.6.3` has target-gated deps only for linux/freebsd/openbsd/macos/ios/windows. On `target_os = "android"` it compiles but `default` becomes the mock in-memory store, so secrets would silently not persist. Hence it must be removed from Android and replaced (1.3), not "left alone".
- `rustls-platform-verifier 0.7.1` and `rustls-platform-verifier-android 0.2.0` are already in `Cargo.lock` via `reqwest 0.13.5` (`rustls-no-provider` still depends on the platform verifier). See 1.6.
- `notify 8.2.0` uses `inotify` on Android (target_os linux/android).
- `dialog 2.8.0` supports Android.

Runtime helper (R0, `git/mod.rs` neighborhood or a new `src-tauri/src/platform.rs`): `pub const EMBEDDED: bool = cfg!(embedded_git);`

Rule: never cfg-gate Tauri commands or IPC types. The command set and `src/ipc/bindings.ts` must be byte-identical on every platform (CI's "bindings up to date" check depends on it). Unsupported operations return `AppError { kind: Unsupported, .. }` at runtime (R0 adds `ErrorKind::Unsupported`; UI must not rely on it for gating, `platform_info` does that).

### 1.2 Networking without a git CLI (R1a)

Current design: `remote/net.rs` builds arg vectors and runs `git` through `NetSession::run`; credentials come from an askpass loopback bridge (`remote/creds.rs`, `askpass.rs`, `main.rs` re-exec of `current_exe`). None of this can work on Android (no git, no re-exec of the app binary as askpass).

Abstraction: `net.rs` keeps every public signature (`fetch`, `pull`, `push`, `clone`, `delete_remote_branch`, `clone_target`, `*_args`, `run_dir`, `classify_failure`). Each of the five operations starts with:

```rust
if super::native::enabled() { return super::native::fetch(sess, dir, request); }
```

where `native::enabled() = cfg!(embedded_git)`. The `*_args` builders and the CLI code stay compiled and untested-by-Android on both platforms (desktop path byte-for-byte unchanged, existing tests keep passing).

New file `git/remote/native.rs` (libgit2 via `git2`):

- `NetSession` gains `resolver: Option<Arc<CredentialResolver>>` (see below) instead of relying on `bridge`. `ops::spawn_op` and `ops::sync_session` build a bridge on desktop and a resolver when `cfg!(embedded_git)`. Constructor signatures used by tests (`NetSession::new`, `plain`) stay valid (resolver defaults to `None`).
- Callbacks (`RemoteCallbacks`):
  - `credentials(url, user_from_url, allowed)`: only `USER_PASS_PLAINTEXT` is served. Attempt 1: stored secret from `SecretStore` (host key = `host[:port]`, the same convention as `keychain::account`). Attempt 2+ (libgit2 calls back after a rejection): delete the stale stored secret and ask the UI via the `CredentialRequested` event (username first, then password/token), honoring `remember`. After 3 attempts fail with `AuthFailed`. SSH/agent/key requests fail immediately with a clear "SSH is not supported on Android" (`Unsupported`).
  - `transfer_progress` / `sideband_progress` / `push_transfer_progress` / `pack_progress`: map to the existing `Progress { phase, percent, message }` so `Throttle`/`OpProgress` need no change.
  - Cancellation: every progress callback returns `false` when `sess.op.is_some_and(|o| o.is_cancelled())`; the resulting libgit2 user-abort error maps to `ErrorKind::Cancelled`.
- Refactor `creds.rs`: extract the body of `resolve_prompt` (keychain lookup -> UI request via `PendingCredentials` -> remember) into `CredentialResolver::ask(kind, host, url, username) -> Option<String>`; the askpass bridge calls it, the native layer calls it. Behavior of the desktop bridge is unchanged (same tests).
- Error mapping `classify_git2_error(&git2::Error) -> ErrorKind`: `ErrorCode::Auth` -> `AuthFailed`; class `Net`/`Http`/`Ssl` or messages like "failed to resolve", "connection", "timed out" -> `Network`; certificate errors -> `Network` with the certificate text in `detail`; user abort -> `Cancelled`; else `GitCli` (kept for UI compatibility).
- `fetch`: `remote.fetch(&[] /* configured refspecs */, opts, None)` with `prune(On)` when `request.prune`, `download_tags(All)` when `request.tags`; `remote: None` (`--all`) iterates `repo.remotes()`.
- `pull`: native fetch, then the merge step goes through the shim (`sess.run(dir, ["merge", "--no-edit", "--", "<oid>"])`, `--ff-only`, or `["rebase", "<oid>"]`). The existing `pull()` keeps its `Oplog::record` wrapper and conflict detection (`conflicted_files`) unchanged, so R1a does not depend on R1b's code, only on the CLI dialect table in 1.4. Resolve the target as today: explicit remote/branch, else the current branch's upstream, else `origin`.
- `push`: refspecs default to the current branch when empty. `force_with_lease`: `remote.connect_auth(Push)`, `remote.list()`, compare the advertised oid with the local `refs/remotes/<remote>/<branch>` oid; mismatch -> error "stale info", else push with a `+` refspec. `tags` adds `refs/tags/*:refs/tags/*`. `set_upstream` sets `branch.<b>.remote/merge` via `Branch::set_upstream` after success. Rejections are reported through `push_update_reference(refname, Some(msg))` and turned into an error (libgit2 does not fail the call by itself).
- `delete_remote_branch`: push `:refs/heads/<branch>` (same path as `push`), keep `Oplog::record` and the preview branch.
- `clone`: `git2::build::RepoBuilder` with `fetch_options`, `bare`; keep the existing destination-cleanup logic; `recurse_submodules` = loop `repo.submodules()` -> `update(true, Some(&mut SubmoduleUpdateOptions{ fetch: opts, .. }))`.
- `validate::url` (`remote/validate.rs`): on `embedded_git` accept only `https://` (plus `http://` and `file://` under `cfg(test)`); reject `ssh://`, `git@host:` with a message pointing to HTTPS + personal access token.
- Certificate store on Android: libgit2/OpenSSL reads the system store `/system/etc/security/cacerts` (hashed directory layout OpenSSL understands). `git2` calls `openssl-probe` at init; R2 also calls `unsafe { git2::opts::set_ssl_cert_locations(None::<&Path>, Some("/system/etc/security/cacerts")) }` at startup as belt and braces. User-installed CAs are not honored in v1 (documented).
- Never start `CredentialBridge` on `embedded_git` (it binds loopback and calls `current_exe`, useless there).

Fallback if the vendored OpenSSL cross-build proves unreliable on CI: keep the same `native.rs` and replace the transport with a reqwest-backed smart HTTP subtransport registered via `git2::transport::register("https", ...)` (`SmartSubtransport`, services `UploadPackLs/UploadPack/ReceivePackLs/ReceivePack`, Basic auth from the resolver, buffering the request body until the first read). That removes OpenSSL entirely and is host-testable with a local `git http-backend` or mockito, at the cost of ~300 lines. Decide only after the first CI build (see risk R1).

### 1.3 Credential and AI key storage (R2)

Problem: `keyring` has no Android store (see 1.1). Existing seams: `remote::keychain::SecretStore` (`get/set/delete(host, username)`) used through the `Keychain` unit struct at `git/remote/ops.rs`, `commands/remotes.rs`; and `ai::settings::KeyStore` (`SystemKeys`) used by `commands/ai.rs`.

Options weighed:

1. `tauri-plugin-stronghold`: heavy (iota stronghold, argon2), needs a user password or key-derivation salt file, adds a large native dep, and the Android build can only be proven on CI. Rejected for v1.
2. Android Keystore through a custom Kotlin Tauri plugin: best protection (non-exportable AES-GCM key wrapping), but hand-written Kotlin/JNI that can only be tested on CI/device. Kept as the v1.1 upgrade behind the same trait (`WrappedFileStore`).
3. **Chosen for v1: `FileStore`** in the app-private data directory (`app_data_dir()/secrets.json`), written atomically (reuse `settings::atomic_write`), mode 0600, on-device protection = per-app sandbox + Android file-based encryption. Justification: tokens are already only readable by our uid; a plaintext-at-rest file matches what git's own `credential.helper store` does; no unverifiable native code. Mitigations: `android:allowBackup="false"` (no cloud/device-transfer copies), values never logged, file never in `repos/`.

Implementation (R2):

- New `src-tauri/src/secrets.rs`, always compiled and unit-tested on the host: `FileStore { path }` with `get/set/delete/list` on a `BTreeMap<String,String>` JSON keyed by `service:account`; implements both `SecretStore` and `KeyStore`. `secrets::init(dir)` stores a process-global `OnceLock<FileStore>` used when `embedded_git`.
- `remote/keychain.rs`: `Keychain` impl becomes `#[cfg(not(embedded_git))]` keyring code / `#[cfg(embedded_git)]` delegate to the global `FileStore`; `Keychain::available()` returns `true` on embedded. `ai/settings.rs`: same for `SystemKeys`. Call sites (`Arc::new(Keychain)`, `SystemKeys`) do not change.
- `lib.rs` setup (`#[cfg(embedded_git)]`): `secrets::init(app.path().app_data_dir()?)` before any command runs.

### 1.4 The embedded-git shim for local git operations (R1b)

The CLI is invoked by these call sites (from `grep` of `GitCli`/`run_git`):

| Call site                                                                                                                      | git dialect used                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `git/staging/commit.rs` `commit_create` (L112)                                                                                 | `commit -F - [--amend] [--allow-empty] ...` with stdin message                                                                           |
| `git/stash_write.rs` (L151, L210, L245, L315)                                                                                  | `stash push [--include-untracked] [--keep-index] [-m msg]`, `stash apply                                                                 | pop <name>`, `stash drop <name>`, restore-dropped helper |
| `git/history/mod.rs::run_git` (used by `merge.rs`, `pick.rs`, `rebase.rs` L126/L365, `sequencer.rs` L48, `switch_branch` L421) | `merge`, `cherry-pick`, `revert`, `rebase` (incl. interactive via `GIT_SEQUENCE_EDITOR`), `switch <branch>`, `--continue/--abort/--skip` |
| `git/conflicts.rs` (L243, L246)                                                                                                | `add -- <path>`, `rm --quiet -f -- <path>`                                                                                               |
| `git/advanced/worktree.rs`                                                                                                     | `worktree list --porcelain                                                                                                               | add                                                      | remove` |
| `git/advanced/history.rs` `file_history`                                                                                       | `log --follow -- <path>`                                                                                                                 |
| `git/remote/net.rs`                                                                                                            | network (handled by 1.2), `pull` merge step (shim)                                                                                       |

Architecture: `GitCli` (in `git/cli/mod.rs`) gets a private `embedded: bool` (`cfg!(embedded_git)` in `new()`, preserved by `with_path`), and `run_streaming` starts with:

```rust
if self.embedded { return embedded::run(dir, &args, opts, op, on_stderr); }
```

`embedded::run` parses the subcommand and dispatches to handlers built on `git2`, returning a `CliOutput { code, stdout, stderr }` that mimics git (exit 0/1/128, `CONFLICT (content): ...` on stderr, `Automatic merge failed; fix conflicts...` etc.) so the callers' existing conflict/error handling keeps working. Unknown subcommands or flags return code 1 with `error: unsupported on this platform: <cmd>` and the caller maps it to `ErrorKind::Unsupported`.

Why a shim rather than rewriting each call site: one choke point, zero churn in the ~15 sites and their arg-building tests, and the existing 20k-line test-suite becomes a parity test for the embedded backend when run with `--features embedded-git` (tests written with `GitCli::new()` automatically exercise it; tests that need CLI-only behavior are marked `#[cfg(not(embedded_git))]`).

v1 handler set, split for parallel work:

- **R1b-1** (`git/cli/embedded/{mod,commit,stash,merge,pick,conflicts,switch}.rs`): `commit` (index -> tree -> commit, amend, allow-empty, message from stdin, author/committer from config; hooks and gpg signing are skipped, warn on stderr if `commit.gpgsign=true`), `stash push/apply/pop/drop` (libgit2 `stash_save` with `INCLUDE_UNTRACKED`/`KEEP_INDEX`, `stash_apply/pop/drop`), `merge` (`--no-edit`, `--ff-only`, `--no-ff`, fast-forward via checkout + ref update, otherwise `merge_commits` + `repo.merge()` state; conflicts leave the index conflicted with `MERGE_HEAD` and exit 1), `cherry-pick`/`revert` (`repo.cherrypick/revert` + state; `--continue/--abort/--skip` via `cleanup_state` and commit), `switch <branch>` (checkout_tree + `set_head`), `add`/`rm`. Creates stub files `rebase.rs`, `worktree.rs`, `log.rs` that return the "unsupported" result so R1b-2 owns those files exclusively.
- **R1b-2** (`git/cli/embedded/{rebase,worktree,log}.rs`, lower priority): non-interactive `rebase` via `git2::Rebase` (used by pull-rebase and `rebase` command); `log --follow` best-effort (revwalk with path filter, rename following via `DiffFindOptions`); `worktree list/add/remove` via libgit2's worktree API. Interactive rebase stays `Unsupported` (UI hides it through `platform_info`).

Absolute-path and process assumptions in this area: `NO_EDITOR` env vars and `GIT_SEQUENCE_EDITOR` are ignored by the shim; `history::sim` already uses libgit2 for previews.

### 1.5 Other modules

| Module                                                                                                                           | Android behavior / action                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git/libgit/*`, `graph`, `oplog`, `preview`, `refs_write`, `staging` (non-commit), `blame`, `submodule` list, `reflog`, `recent` | Pure libgit2 or std file IO: work as is. `oplog` stores snapshots inside `.git` (repo-relative), no absolute path assumptions found.                                                                                                                                                                                                                                                           |
| `git/watcher.rs` (`notify` 8, inotify)                                                                                           | Compiles and works on Android for repos in the app-private dir. Keep. Watcher is dropped when the app is backgrounded/killed; the UI refetches on resume (UI package).                                                                                                                                                                                                                         |
| `git/recent.rs`, `settings`, `ai/settings` storage                                                                               | Use `app.path().app_data_dir()` / `app_config_dir()`, which Tauri resolves to the app-private dir on Android. No change.                                                                                                                                                                                                                                                                       |
| `settings/mod.rs::validate_git_path` and `git_path` setting                                                                      | Uses `Command::new(p)`; compiles on Android but is meaningless. R2: on `embedded_git` ignore `git_path` in `set_git_path` and let `settings_get` return it untouched; the UI hides the field via `platform_info.hasGitCli`.                                                                                                                                                                    |
| `commands/app.rs::app_info`                                                                                                      | `Command::new("git")` fails -> `git_version: None`. R0: on `embedded_git` return `Some(format!("libgit2 {}", git2::Version::get().libgit2_version()...))` so the status bar does not say "git not found". `platform` already reports `std::env::consts::OS` = `"android"`.                                                                                                                     |
| `main.rs` / `askpass.rs`                                                                                                         | Desktop only. On Android the process is started from `lib.rs::run` via the Tauri mobile glue, `main.rs` is not used. No change.                                                                                                                                                                                                                                                                |
| `lib.rs`                                                                                                                         | Already has `#[cfg_attr(mobile, tauri::mobile_entry_point)]` and `crate-type = ["staticlib","cdylib","rlib"]`, `[lib] name = "gittrunk_lib"` (Android loads `libgittrunk_lib.so`). R2: gate the `export_bindings` debug block with `#[cfg(all(debug_assertions, not(mobile)))]`.                                                                                                               |
| `tauri-plugin-dialog`                                                                                                            | Compiles on Android; folder picker returns content URIs (unusable as repo paths). "Open folder" is out of scope: UI hides it; `repo_open` remains for paths under `defaultReposDir`.                                                                                                                                                                                                           |
| Absolute paths / process spawning                                                                                                | `net::clone_target` uses `std::path::absolute` (fine, dest is absolute app-private path). No `/tmp`, `/usr/bin`, drive letters or `$HOME` assumptions found in non-test code. libgit2 has no `$HOME` on Android: R2 sets the global config search path to the app data dir (below).                                                                                                            |
| Git identity                                                                                                                     | No `~/.gitconfig` on Android, and `check_identity` (commit/stash) fails without `user.name`/`user.email`. R2 at startup: `unsafe { git2::opts::set_search_path(git2::ConfigLevel::Global, <app_data_dir>) }` so `Config::open_default()` reads/writes `<app_data_dir>/.gitconfig`. R0 adds `git_identity_get/set` commands (write global config) and the UI asks for it on first commit/clone. |
| Repo ownership check                                                                                                             | libgit2 refuses repos not owned by the current uid; app-private dirs are ours, but to be safe against future SAF/shared storage: `unsafe { git2::opts::set_verify_owner_validation(false) }` on `embedded_git` (R2; verify the exact function name against git2 0.21 docs when implementing).                                                                                                  |
| TLS for reqwest (AI providers)                                                                                                   | See 1.6.                                                                                                                                                                                                                                                                                                                                                                                       |
| `parking_lot`, `tokio`, `serde`, `specta`, `tauri-specta`                                                                        | Pure Rust, Android-safe.                                                                                                                                                                                                                                                                                                                                                                       |
| `ring` (via rustls)                                                                                                              | Builds with the NDK clang that `tauri android build` exports (`CC_<target>`, `AR_<target>`).                                                                                                                                                                                                                                                                                                   |

### 1.6 rustls-platform-verifier (flag)

`reqwest 0.13.5` with feature `rustls-no-provider` depends on `rustls-platform-verifier 0.7.1`. On Android that verifier calls into the JVM and needs a Kotlin component plus Gradle wiring (Maven repo `https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/`, version synced from `Cargo.lock`) and a runtime `init`. Without it, the first HTTPS client build panics ("Expect rustls-platform-verifier to be initialized").

Decision v1: avoid the JVM path. R2, in `ai/provider.rs::build_client`, under `#[cfg(target_os = "android")]`:

```rust
let mut roots = rustls::RootCertStore::empty();
roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
let tls = rustls::ClientConfig::builder().with_root_certificates(roots).with_no_client_auth();
reqwest::Client::builder().use_preconfigured_tls(tls) /* + existing timeouts */
```

(`rustls` is already a direct dep at 0.23 with the `ring` provider, which must match reqwest's rustls version; the code already installs the ring provider). Trade-off: Mozilla roots only (user-installed CAs, corporate proxies not trusted). v1.1 alternative: add the Kotlin component and `rustls_platform_verifier::android::init_hosted` from `JNI_OnLoad`-equivalent setup, verified on the emulator smoke job.

### 1.7 Tauri config and mobile entry (R2)

- `src-tauri/tauri.android.conf.json` (merged over `tauri.conf.json` for Android builds):
  ```json
  {
    "$schema": "https://schema.tauri.app/config/2",
    "bundle": { "android": { "minSdkVersion": 24 } }
  }
  ```
  Do not set `versionCode`: Tauri derives it from `version` as `major*1_000_000 + minor*1_000 + patch` (0.1.0 -> 1000, 0.2.3 -> 2003); pre-release suffixes are ignored. Keep minor/patch below 1000. C2 may add a guard for that to `scripts/check-version.mjs`.
- `identifier` stays `dev.gittrunk.client` (Kotlin package `dev.gittrunk.client`, lib `libgittrunk_lib.so`).
- CSP in `tauri.conf.json` already allows `ipc:` and `http://ipc.localhost`; Android's WebView origin is `http://tauri.localhost`, covered by `'self'`. No change needed; re-check in the first emulator run.
- `capabilities/default.json` applies to all platforms (no `platforms` key); dialog permissions stay. Only the `$schema` hint refers to `desktop-schema.json`; harmless.
- Permissions: `INTERNET` is present in Tauri's Android template manifest; `customize.mjs` asserts it and fails if missing. No storage permissions (app-private dir). `android:allowBackup="false"`, `android:usesCleartextTraffic="false"` for release, `android:windowSoftInputMode="adjustResize"` on `MainActivity` so the commit message field stays visible with the IME.
- Icons: `src-tauri/icons/icon.png` is 512x512; run `pnpm tauri icon src-tauri/icons/icon.png -o <tmpdir>` and copy only `<tmpdir>/android/*` to `src-tauri/icons/android/` (do not touch desktop icons, do not commit ios). Ask design for an adaptive-icon foreground with safe padding; a 1024x1024 source is preferable.

---

## 2. Frontend platform detection

New IPC (contract package R0):

```rust
wire! {
    pub struct PlatformInfo {
        pub os: String,                       // "android" | "windows" | "macos" | "linux"
        pub mobile: bool,
        pub has_git_cli: bool,                // false on embedded_git
        pub can_pick_folder: bool,            // "open existing folder"
        pub supports_ssh: bool,
        pub supports_external_editor: bool,
        pub supports_interactive_rebase: bool,
        pub supports_worktrees: bool,
        pub supports_hooks: bool,             // commit hooks / signing
        pub secret_store: String,             // "keychain" | "file"
        pub default_repos_dir: Option<String>,// Some(<app_data_dir>/repos) on mobile
    }
}
#[tauri::command] #[specta::specta]
pub async fn platform_info(app: tauri::AppHandle) -> AppResult<PlatformInfo>
```

Also in R0: `git_identity_get() -> GitIdentity { name: Option<String>, email: Option<String> }`, `git_identity_set(name, email)` (global config), `repo_delete(path)` (mobile storage management: close the repo, refuse unless the path is inside `default_repos_dir`, then remove it and drop it from `recent`), and `ErrorKind::Unsupported`.

Why a command and not `@tauri-apps/plugin-os`: capabilities such as `hasGitCli` and `supportsWorktrees` are backend facts that can change independently of the OS; one source of truth, no new plugin/permission, and it is mockable in the vitest mocks. UI first paint may use `navigator.userAgent.includes("Android")`, then switch to the query result (`queryKeys.platformInfo`, `staleTime: Infinity`) in `src/ipc/queries.ts`.

R0 also regenerates `src/ipc/bindings.ts` (`pnpm bindings`) and adds `"platformInfo"`, `"gitIdentityGet"`, `"gitIdentitySet"`, `"repoDelete"` to the `names` list in `src/app/mockBindings.ts` with default mocks in `src/app/testing.tsx`. After that lands, UI packages must not edit those two files or the generated bindings.

---

## 3. CI

### 3.1 Creating `src-tauri/gen/android`

Options:

- A. Run `pnpm tauri android init --ci` on every build and patch with scripts. Pros: nothing generated is committed. Cons: every build depends on template drift and patch regexes; Gradle caches key on files that change each run; hard to debug.
- B. **Recommended: generate once in CI, commit the result.** Tauri's own docs recommend committing `gen/android` (minus build outputs). It gives reproducible Gradle inputs (cache keys work), reviewable customization diffs, and makes app name/permissions/signing/versionCode configurable in normal PRs.

Mechanism: `.github/workflows/android-init.yml` (`workflow_dispatch`, input `commit` default true). Steps: checkout, same toolchain setup as the build, `pnpm tauri android init --ci`, copy android icons, run `node scripts/android/customize.mjs`, then either commit `src-tauri/gen/android` and `src-tauri/icons/android` back to the dispatching branch (refuse on `main`; `contents: write`; commit by `github-actions[bot]`, so it does not trigger workflows, dispatch `build-android` manually) or, with `commit=false`, upload artifact `gen-android` (for manual download). Re-running it after a Tauri upgrade produces a reviewable diff.

`scripts/android/customize.mjs` (idempotent, tracked; rerunnable, asserts each patch applied exactly once):

1. `app/build.gradle.kts`: add a `signingConfigs.release` that reads `rootProject.file("keystore.properties")` (keys `keyAlias`, `keyPassword`, `storeFile`, `storePassword`) only if the file exists, and attach it to `buildTypes.release`.
2. `AndroidManifest.xml`: assert `INTERNET`; set `allowBackup=false`, `usesCleartextTraffic=false`, `windowSoftInputMode=adjustResize`.
3. `.gitignore` inside `gen/android` must contain `keystore.properties`, `local.properties`, `tauri.properties`, `build/`, `.gradle/` (root `.gitignore` gets the same lines: C1 owns it).

Gradle snippet (Kotlin DSL) inserted by the script:

```kotlin
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = java.util.Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}
android {
    signingConfigs {
        if (keystorePropsFile.exists()) {
            create("release") {
                keyAlias = keystoreProps["keyAlias"] as String
                keyPassword = keystoreProps["keyPassword"] as String
                storeFile = file(keystoreProps["storeFile"] as String)
                storePassword = keystoreProps["storePassword"] as String
            }
        }
    }
    buildTypes {
        getByName("release") {
            if (keystorePropsFile.exists()) signingConfig = signingConfigs.getByName("release")
        }
    }
}
```

App name comes from `productName` (`gittrunk`) via `strings.xml`; version name from `tauri.conf.json` `version`; version code derived (1.7).

### 3.2 Composite action `.github/actions/build-android/action.yml`

Reason: `release.yml` also needs the build, and a reusable workflow with its own `concurrency` collides with the caller's group. A composite action shares the steps with no concurrency coupling. Inputs: `abis` (comma list, default `aarch64,x86_64`), `sign` (`dev` | `release`), `keystore-base64`, `keystore-password`, `key-alias`, `key-password`, `lto` (default empty = full; `thin` for PR builds). Output: `apk-dir`.

Steps (all `shell: bash`):

1. `actions/setup-node@v7` (node 22), Corepack + pnpm exactly as in `build-windows.yml` (`corepack enable`, `pnpm store path`, `actions/cache@v6` for the store), `pnpm install --frozen-lockfile`.
2. `actions/setup-java` (temurin 17; use the current major, v5 at time of writing) with `cache: gradle`.
3. `dtolnay/rust-toolchain@stable` with `targets` derived from `abis` (`aarch64->aarch64-linux-android`, `armv7->armv7-linux-androideabi`, `x86_64->x86_64-linux-android`; `i686` not shipped), `Swatinem/rust-cache@v2` with `workspaces: src-tauri` and `key: android-${{ inputs.abis }}`.
4. Environment: ubuntu runners ship the SDK/NDK.
   ```bash
   echo "NDK_HOME=$ANDROID_NDK_LATEST_HOME"     >> "$GITHUB_ENV"
   echo "ANDROID_NDK_HOME=$ANDROID_NDK_LATEST_HOME" >> "$GITHUB_ENV"
   echo "ANDROID_NDK_ROOT=$ANDROID_NDK_LATEST_HOME" >> "$GITHUB_ENV"
   echo "$ANDROID_NDK_LATEST_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin" >> "$GITHUB_PATH"
   ```
   (`openssl-src` reads `ANDROID_NDK_HOME` and needs the NDK toolchain `bin` on `PATH`; `ANDROID_HOME` is preset by the image.) If the image lacks `platforms;android-36`/matching build-tools, run `yes | sdkmanager --licenses` and `sdkmanager "platforms;android-36" "build-tools;36.0.0"` (guarded so failure only warns; Gradle would fetch them anyway).
5. Signing:
   - `sign=release`: require all four secrets (fail with `::error::` if any is empty), decode `keystore-base64` to `$RUNNER_TEMP/release.jks`, write `src-tauri/gen/android/keystore.properties` with `storeFile` = that absolute path.
   - `sign=dev` (all push/PR/dispatch builds; never use repository secrets there, same policy as `build-windows.yml`): generate a throwaway key with `keytool -genkeypair -keystore $RUNNER_TEMP/ci.jks -alias gittrunk-ci -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=gittrunk CI"` with a random password (`openssl rand -hex 16`, `::add-mask::`), write `keystore.properties`. Emit `::notice::Android APK is signed with a throwaway CI key: it installs fine, but cannot be updated over another build (uninstall first).` Decision: build the **release** variant with a throwaway key rather than the debug variant, so CI exercises R8/minification, LTO and real performance, and the artifact is directly installable. (An unsigned release APK cannot be installed at all; the debug variant would be debug-signed with a per-runner `debug.keystore`, also non-upgradable, and would not test the release pipeline.)
6. Build (ABIs default `aarch64,x86_64` for push/PR: shipping arch plus the arch the emulator smoke job uses; release uses all three):
   ```bash
   pnpm tauri android build --help | head -40   # log the accepted flags (cheap diagnosability)
   args=(); for a in ${ABIS//,/ }; do args+=(--target "$a"); done
   pnpm tauri android build --apk --ci "${args[@]}"
   ```
   Env for PR builds (`lto: thin`): `CARGO_PROFILE_RELEASE_LTO=thin`, `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16` to keep cold builds acceptable; releases use the profile in `Cargo.toml` (fat LTO, `codegen-units=1`). The `--target` value syntax (repeat vs space separated) must be confirmed from the logged `--help` on the first CI run.
   APK vs AAB: APK only (sideload). `--aab` is deferred until a Play Store decision. Universal APK (one file with all requested ABIs) rather than `--split-per-abi`: simplest for users; size is roughly 3 native libs (expect a 40-70 MB APK for the release universal build; measure).
7. Verify and collect: locate `src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk` (assert exactly one, not `*-unsigned.apk`); with the newest `$ANDROID_HOME/build-tools/*/`: `apksigner verify --print-certs` and `aapt2 dump badging | grep -E "package: name='dev.gittrunk.client'|sdkVersion:'24'"`. Rename to `gittrunk_${VERSION}_android-universal.apk` (`VERSION` from `tauri.conf.json`) or `gittrunk_${VERSION}_android-<abis>.apk` for partial-ABI builds, into `out/`.

### 3.3 `.github/workflows/build-android.yml`

```yaml
# Builds the Android APK and uploads it as a workflow artifact. Dev-signed with
# a throwaway key (never uses repository secrets). Releases: release.yml.
name: Build Android

on:
  push:
    branches: [main, develop, "claude/**", "feat/**"]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      abis:
        description: "Comma list of ABIs: aarch64, armv7, x86_64"
        default: "aarch64,x86_64"

concurrency:
  group: build-android-${{ github.ref }}
  cancel-in-progress: true

env:
  CARGO_TERM_COLOR: always

jobs:
  android:
    name: Android APK # required-status-check context (see 4.3)
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v7
      - id: build
        uses: ./.github/actions/build-android
        with:
          abis: ${{ inputs.abis || 'aarch64,x86_64' }}
          sign: dev
          lto: thin
      - uses: actions/upload-artifact@v7
        with:
          name: gittrunk-android-${{ github.sha }}
          path: out/*.apk
          if-no-files-found: error
          retention-days: 14

  smoke: # stretch (C1, phase 2): starts non-blocking
    name: Android emulator smoke
    needs: android
    runs-on: ubuntu-24.04
    continue-on-error: true
    steps:
      - uses: actions/download-artifact@v7 (name gittrunk-android-${{ github.sha }})
      - run: sudo chmod 666 /dev/kvm # udev rule for KVM on hosted runners
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          arch: x86_64
          script: |
            adb install -r gittrunk_*_android-*.apk
            adb shell am start -n dev.gittrunk.client/.MainActivity
            sleep 20
            adb shell pidof dev.gittrunk.client
            ! adb logcat -d | grep -E "FATAL EXCEPTION|panicked at|rustls-platform-verifier"
```

The smoke job is the only thing that can prove the app starts (JNI symbols, TLS init, WebView, IPC). Promote it to required once stable.

---

## 4. Release integration

### 4.1 `release.yml`

1. `verify`: the loop `for wf in ci.yml build-windows.yml` becomes `for wf in ci.yml build-windows.yml build-android.yml`; update the error text and the header comment. The step name becomes "CI, Build Windows and Build Android must have passed for this commit".
2. New job after `build` (it needs the draft release that `tauri-action` creates there):
   ```yaml
   android:
     name: Android APK
     needs: [verify, build]
     if: ${{ needs.build.result == 'success' }}
     runs-on: ubuntu-24.04
     timeout-minutes: 90
     env: { VERSION: "${{ needs.verify.outputs.version }}", GH_TOKEN: "${{ github.token }}" }
     steps:
       - uses: actions/checkout@v7
         with: { ref: "${{ needs.verify.outputs.sha }}" }
       - uses: ./.github/actions/build-android
         with:
           abis: aarch64,armv7,x86_64
           sign: release
           keystore-base64: ${{ secrets.ANDROID_KEYSTORE }}
           keystore-password: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
           key-alias: ${{ secrets.ANDROID_KEY_ALIAS }}
           key-password: ${{ secrets.ANDROID_KEY_PASSWORD }}
       - name: Upload APK to the draft release
         run: gh release upload "v$VERSION" out/*.apk --repo "$GITHUB_REPOSITORY" --clobber
   ```
   Decision on missing secrets in release: hard fail for the Android leg (an APK signed with a throwaway key on a release would be a non-upgradable trap for users); the desktop legs are unaffected because `publish` requires all legs, so the draft simply stays unpublished with a clear error. If maintainers prefer parity with Windows ("unsigned with a notice"), switch this leg to `sign: dev` and rename the asset `..._android-universal-devsigned.apk`; not recommended.
3. `publish`: `needs: [verify, build, android]`, `if: needs.build.result == 'success' && needs.android.result == 'success'`, and add `'_android-universal\.apk$'` to the pattern list in "Verify expected assets exist".
4. The version-file gate already covers Android (versionName from `tauri.conf.json`; versionCode is derived).

### 4.2 Secrets (document in `docs/RELEASING.md`)

`ANDROID_KEYSTORE` (base64 of the `.jks`, single line: `base64 -w0 gittrunk-release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Create with `keytool -genkeypair -v -keystore gittrunk-release.jks -alias gittrunk -keyalg RSA -keysize 4096 -validity 36500`. Back the key up: losing it means installed users can never update. Consider an `android-release` GitHub Environment to gate the secrets.

### 4.3 Ruleset `.github/rulesets/main-protection.json`

Add `{ "context": "Android APK", "integration_id": 15368 }` to `required_status_checks` (after the existing "build"). Do not add `paths` filters to `build-android.yml` (a filtered required workflow would block PRs it skips). The check name must be unique: the release workflow's own job is also called `Android APK` but is not run on PRs, so no clash; if confusion arises, name the release job `Android release APK`. The context only exists after the first run on the repo; `do_not_enforce_on_create` is already set. Apply the updated ruleset by re-importing the JSON in repository settings (manual step for the maintainer).

### 4.4 CI for the embedded backend on the host (C2, `ci.yml`)

Add to the ubuntu leg after the existing cargo steps: `cargo clippy --all-targets --features embedded-git -- -D warnings` and `cargo test --features embedded-git`. This is what keeps the Android code paths honest on every PR without an NDK. (The test job needs libssl-dev only for desktop keyring deps, already installed.)

---

## 5. Local verification strategy

Runnable in this container (no NDK/SDK, crates.io/npm/maven/gradle reachable):

- `cd src-tauri && cargo fmt --all --check`
- `cargo clippy --all-targets -- -D warnings` (desktop path, must stay untouched) and `cargo clippy --all-targets --features embedded-git -- -D warnings`.
- `cargo test` and `cargo test --features embedded-git`. With the feature on, `GitCli::new()` is the embedded backend and the credentials path is the resolver, so the whole existing suite (commit, stash, history, conflicts, remote ops against `file://` remotes created with the real `git` binary) is a parity test of the shim. Tests that rely on CLI-only behavior (hooks, signing, interactive rebase, worktrees until R1b-2 lands) are annotated `#[cfg(not(embedded_git))]`. New unit tests: `secrets::FileStore` (round trip, 0600 mode, atomic write, delete missing), `CredentialResolver` with a fake `SecretStore`, `classify_git2_error`, `native` fetch/push/clone against local `file://` repos (libgit2 supports the local transport without TLS; `http://` against `git http-backend` is optional).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm bindings` + `git diff --exit-code src/ipc/bindings.ts`.
- Dependency resolution for Android without compiling: `cd src-tauri && cargo tree --target aarch64-linux-android -i keyring` (must report that it is not in the graph), `cargo tree --target aarch64-linux-android -i openssl-sys -e features`, `cargo tree --target aarch64-linux-android -p git2 -e features` (must show `https`, `vendored-openssl`), and the desktop target must not show `openssl-sys` from `git2`. Also `cargo metadata --filter-platform aarch64-linux-android --format-version 1 >/dev/null`.
- `node scripts/android/customize.mjs --check` against a fixture copy of Tauri's template (R2/C1 keep a small fixture under `scripts/android/fixtures/` so the patcher is unit-tested with `node --test` locally).
- YAML lint of workflows (`actionlint` if installable via `go`/npm; otherwise `python -c "import yaml"` syntax check).

Not possible locally: `cargo check --target aarch64-linux-android`. Even if `rustup target add` can fetch the std component, `cargo check` runs build scripts, and `libgit2-sys`, `ring`, `openssl-src` and `libz-sys` all invoke the C toolchain through the `cc` crate for `aarch64-linux-android`, which needs the NDK clang (`aarch64-linux-android24-clang`) that only comes from dl.google.com. The build script failure happens before any of our Rust is checked. The `embedded-git` host feature is the substitute: the Android code paths compile and run on the host except the OpenSSL link and JNI/Gradle parts.

Only CI proves: NDK cross-compile of libgit2/OpenSSL/ring, Gradle/AGP build, manifest merge, signing, APK contents (`apksigner`, `aapt2`), and (smoke job) that the app actually starts on an x86_64 emulator. Iteration loop for builders: push to a `claude/**` branch, watch `Build Android` through the GitHub MCP (`actions_list`, `get_job_logs`), fix, repeat.

---

## 6. Work packages

All packages have disjoint file ownership. `Cargo.toml`, `Cargo.lock`, `build.rs`, `src/ipc/**`, `src/app/mockBindings.ts`, `src/app/testing.tsx` (only the Android additions) belong to R0 alone; anyone else needing a change asks R0.

Order: **Phase 0**: R0 and C1a in parallel. **Phase 1** (first green APK milestone "M-A0" after R0+R2+C1b, network still stubbed): R2, then C1b; in parallel R1a, R1b-1, UI packages (designer's, after R0's contract is merged). **Phase 2**: R1b-2, C1c (smoke), C2. **Phase 3**: integration and release rehearsal.

### R0: contract and build plumbing (first, small)

Files: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/build.rs`, `src-tauri/src/ipc/types.rs` (`PlatformInfo`, `GitIdentity`), `src-tauri/src/ipc/error.rs` (`ErrorKind::Unsupported`), `src-tauri/src/ipc/mod.rs` (register commands), `src-tauri/src/commands/app.rs` (`platform_info`; libgit2 version in `app_info` on embedded), `src-tauri/src/commands/identity.rs` (new: `git_identity_get/set`), `src-tauri/src/commands/repo.rs` (`repo_delete`), `src-tauri/src/commands/mod.rs`, `src/ipc/bindings.ts` (regenerated), `src/ipc/queries.ts` (`platformInfo` query), `src/app/mockBindings.ts`, `src/app/testing.tsx`.
Done when: `cfg(embedded_git)` alias, the Android-only dependency tables, and the `embedded-git` feature exist; desktop `cargo test` and `pnpm test` unchanged; `pnpm bindings` diff committed; grep the frontend for exhaustive `ErrorKind` switches and update them.
Depends on: nothing. Blocks: everyone (contract), except C1a.

### R2: platform bootstrap, secrets, config

Files: `src-tauri/src/secrets.rs` (new), `src-tauri/src/lib.rs`, `src-tauri/src/git/remote/keychain.rs`, `src-tauri/src/ai/settings.rs`, `src-tauri/src/ai/provider.rs`, `src-tauri/src/settings/mod.rs`, `src-tauri/tauri.android.conf.json`, `src-tauri/capabilities/*` (if needed), `src-tauri/icons/android/**` (from `tauri icon`; committed by C1a's run, R2 only decides the source icon).
Done when: file store unit tests pass on host; startup sets global git config dir, owner validation, CA path (android-gated); `build_client` uses the webpki-roots config on Android; `embedded_git` swaps `Keychain`/`SystemKeys` without call-site changes.
Depends on: R0.

### R1a: native network layer

Files: `src-tauri/src/git/remote/{native.rs (new), net.rs, ops.rs, creds.rs, validate.rs, mod.rs, tests.rs (additions only for native)}`, `src-tauri/src/commands/remotes.rs`, `src-tauri/src/commands/repo.rs::repo_clone` is R0-owned: R1a needs no change there.
Done when: 1.2 is implemented and `cargo test --features embedded-git` passes for fetch/pull/push/clone/delete-remote-branch against local remotes; desktop behavior and tests unchanged.
Depends on: R0. Consumes from R1b only the CLI dialect (`merge`, `rebase` invocations) via `sess.run`.

### R1b-1: embedded git shim, core

Files: `src-tauri/src/git/cli/mod.rs` (`embedded` flag and dispatch), `src-tauri/src/git/cli/embedded/{mod.rs,commit.rs,stash.rs,merge.rs,pick.rs,conflicts.rs,switch.rs,rebase.rs (stub),worktree.rs (stub),log.rs (stub)}`, `src-tauri/src/git/cli/tests.rs`, and `#[cfg(not(embedded_git))]` annotations in the existing test files under `git/history/tests.rs`, `git/staging/tests.rs`, `git/stash_write/tests.rs`, `git/advanced/tests.rs`, `git/conflicts/tests.rs`, `git/crlf_tests.rs` (annotation-only edits).
Done when: `cargo test --features embedded-git` is green for commit/stash/merge/cherry-pick/revert/reset/conflicts; exit codes and stderr shapes match what `history/*`, `stash_write.rs`, `staging/commit.rs`, `conflicts.rs` parse.
Depends on: R0.

### R1b-2: embedded git shim, advanced (lower priority)

Files: `src-tauri/src/git/cli/embedded/{rebase.rs,worktree.rs,log.rs}` and the test annotations they un-gate.
Done when: non-interactive rebase (also used by pull --rebase), `log --follow` best effort, worktree list/add/remove pass their existing tests under `--features embedded-git`; interactive rebase remains `Unsupported`.
Depends on: R1b-1.

### C1a: Android project generation

Files: `.github/workflows/android-init.yml`, `scripts/android/customize.mjs`, `scripts/android/fixtures/**`, `src-tauri/gen/android/**` (produced by the workflow and committed), `src-tauri/icons/android/**`, `.gitignore` (Android lines).
Done when: `android-init` has been run once on a `claude/**` branch, the generated project plus customization is committed, and reviewed (manifest flags, signing block).
Depends on: nothing to start (can run against current `main` config); re-run after R2's `tauri.android.conf.json` lands if `minSdk` needs to be reflected.

### C1b: Android build workflow

Files: `.github/actions/build-android/action.yml`, `.github/workflows/build-android.yml`.
Done when: `Build Android` is green on a branch and uploads a verified APK (M-A0). Expect several iterations on NDK/OpenSSL/Gradle issues; C1b owns these fixes to workflow files only, and reports Rust/Cargo problems to R0/R2/R1a.
Depends on: R0 (Android deps), C1a (gen/android), R2 (config; the very first attempt can run with stubs to shake out OpenSSL early).

### C1c: emulator smoke job (stretch)

Files: the `smoke` job in `.github/workflows/build-android.yml` (same file as C1b, so C1c starts only after C1b has merged).

### C2: release, ruleset, docs

Files: `.github/workflows/release.yml`, `.github/rulesets/main-protection.json`, `.github/workflows/ci.yml` (embedded-git steps), `docs/BUILD.md` (section "Building for Android": JDK 17, Android SDK/NDK, `ANDROID_HOME`, `NDK_HOME`, `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android`, `pnpm tauri android init`, `pnpm tauri android dev`, sideloading, the throwaway-key notice), `docs/RELEASING.md` (Android secrets, verify gate, asset list, key custody), `README.md` (Android section, HTTPS-token-only remotes, no SSH), `docs/ARCHITECTURE.md` (embedded git, secrets, platform_info), `docs/PLAN.md` (milestone entry), optionally a `scripts/check-version.mjs` guard for minor/patch < 1000.
Depends on: C1b for the exact job name; R2 for the doc facts. Can start the release.yml/ruleset edits as soon as C1b's job name is fixed.

### UI packages (from `docs/MOBILE_DESIGN.md`, designer)

Depend on R0 (`platformInfo`, `gitIdentity*`, `repoDelete`, `Unsupported`). They own `src/features/**`, `src/design/**` and `src/app/**` except `mockBindings.ts`/`testing.tsx` additions and the generated bindings. Capability use: hide "Open folder" (`canPickFolder`), external editor/`git_path` field (`hasGitCli`, `supportsExternalEditor`), SSH URL entry and key prompts (`supportsSsh`), worktrees (`supportsWorktrees`), interactive rebase (`supportsInteractiveRebase`); clone dialog default destination `defaultReposDir` + repo name; first-run identity prompt; HTTPS token entry via existing `credential_store`/`CredentialRequested`; repo delete affordance for mobile storage.

---

## 7. Risks and fallbacks

1. **Vendored OpenSSL cross-build fails on CI** (perl/NDK env, or 16 KB page-size linking with NDK r28). Mitigation: export `ANDROID_NDK_HOME/ROOT` and NDK `bin` on `PATH` (3.2 step 4); first CI run happens right after R0 with stubs to find this early. Fallback: reqwest-backed custom libgit2 transport (1.2), which removes OpenSSL and is host-testable.
2. **Fat LTO, `codegen-units=1` and three ABIs make release builds slow or memory-hungry** (runner has 16 GB). Mitigation: thin LTO for PR builds, per-ABI cache, `timeout-minutes`. Fallback for release: `CARGO_PROFILE_RELEASE_LTO=thin`, or ship `--split-per-abi` APKs.
3. **Shim fidelity**: emulating git's exit codes/stderr for merge/cherry-pick/revert conflict states is the riskiest logic. Mitigation: the existing suite as a parity test (`--features embedded-git`), explicit Unsupported for anything not implemented, features hidden in the UI through `platform_info`. Fallback: ship v1 without rebase/worktrees/file-history follow.
4. **libgit2 semantic differences**: no hooks, no gpg signing, no `.gitattributes` filters beyond libgit2's support, no credential helpers, CRLF handling per libgit2 config. Documented as limitations; warn in the UI when `commit.gpgsign` is set.
5. **Secrets at rest are plaintext in the app sandbox** (v1). Mitigations: 0600, `allowBackup=false`, `SecretStore` seam for Keystore-wrapped storage (v1.1). Rooted devices can read it; state this in the docs.
6. **`rustls-platform-verifier` JNI init** (1.6): avoided with webpki roots; if a future dependency constructs the platform verifier anyway, the emulator smoke job catches the panic. Fallback: add the Kotlin component and init.
7. **Tauri CLI details unverifiable locally** (`--target` syntax, output APK path, template contents). Mitigations: log `--help`, glob the APK path, `customize.mjs` asserts each patch and fails loudly, `android-init` regeneration is one click.
8. **Filesystem/watcher limits**: inotify watch limits on large repos; large clones on device storage. Mitigation: the UI shows clone size/progress; `repo_delete` for cleanup; on watcher failure `ensure_watcher` already degrades silently (verify in R2 review).
9. **Ruleset requires a check that does not exist until it has run once** and adds ~20-40 min to every PR. Mitigation: `do_not_enforce_on_create`, thin LTO, caches, `cancel-in-progress`. If it proves too slow, make PR builds single-ABI (`aarch64`) and keep `x86_64` for the smoke job on `main` only.
10. **Android 15+ / target SDK policy and 16 KB pages**: keep the template's target SDK; NDK r28 aligns by default. Re-check before any Play Store submission (out of scope).
11. **Upgradability of CI APKs**: throwaway keys make each CI APK non-updatable over another. Documented in the notice and BUILD.md; releases use the fixed keystore.

---

## 8. Milestones

- M-A0: `Build Android` green, verified APK artifact (needs R0, R2, C1a, C1b; network/local git may still be stubs).
- M-A1: clone + fetch/pull/push over HTTPS token works on an emulator (R1a, R1b-1; needs UI clone flow).
- M-A2: commit/stash/merge/cherry-pick/revert/conflict resolution (R1b-1), mobile UI complete.
- M-A3: release rehearsal with a real keystore on a `v0.x.y-rc.1` (C2, R1b-2 optional).
