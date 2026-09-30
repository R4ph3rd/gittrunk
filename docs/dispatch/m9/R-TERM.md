# R-TERM: PTY terminal backend

- Wave: 1
- Agent: `rust-git-agent`, model **sonnet**
- Branch/worktree: `feat/terminal-pty`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.2 (Terminal), merged contract: `src-tauri/src/ipc/types.rs` (`TerminalOpenRequest`, `TerminalOutput`, `TerminalExit`), `src-tauri/src/commands/terminal.rs` (stubs), `src-tauri/src/terminal/mod.rs` (placeholder), `src-tauri/src/lib.rs` (managed state), portable-pty 0.9 docs (`native_pty_system`, `PtySize`, `CommandBuilder`, `MasterPty`, `ChildKiller`).
- Rust only.

## Goal

Real shell sessions in a pseudo-terminal, one per id, streamed to the webview with typed events, on Windows (ConPTY), macOS and Linux. Android returns `Unsupported`.

## Owned files

`src-tauri/src/terminal/**` (replace the placeholder; keep `pub struct Terminals` with `Default`, `Send + Sync`), `src-tauri/src/commands/terminal.rs` (bodies only).
Must NOT touch: signatures, `ipc/**`, `lib.rs`, `Cargo.toml`, anything in `src/`.

## Behavior

- Everything using `portable_pty` is behind `#[cfg(not(target_os = "android"))]` (the dependency only exists there); on Android every command returns `AppError::unsupported("The terminal")`.
- `open(request)`: `cwd` must be an existing directory (`InvalidInput` otherwise); `cols` clamped to 2..=1000, `rows` to 1..=500; at most 16 live sessions (`InvalidInput` beyond). Shell from a pure, unit-tested `fn shell_command(env: &impl Fn(&str) -> Option<String>, os: &str) -> (String, Vec<String>)`:
  - unix: `$SHELL` if it is an absolute path, else `/bin/sh`; args `["-l"]` when the basename is `sh`, `bash`, `zsh`, `fish`, `ksh` or `dash`, else none.
  - windows: `pwsh.exe` when found on `PATH`, else `powershell.exe`; args `["-NoLogo"]`; `COMSPEC` (`cmd.exe`) only when neither is found.
    Environment: inherit, plus `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=gittrunk`. Returns a new id (`term-<n>`, monotonic).
- Output: a reader thread per session reads up to 16 KiB at a time and emits `TerminalOutput { id, data }`. `data` is valid UTF-8: an incomplete trailing sequence is carried to the next read; invalid bytes become U+FFFD. On EOF it waits for the child and emits `TerminalExit { id, code }` (exit code when available), then removes the session. Implement emission through a callback (`Arc<dyn Fn(TermEvent) + Send + Sync>`) so tests run without Tauri; the command passes a closure that calls `.emit(&app)`.
- `write(id, data)`: writes all bytes and flushes; unknown id -> `InvalidInput` "terminal <id> is closed".
- `resize(id, cols, rows)`: same clamps, `MasterPty::resize`.
- `close(id)`: kill the child, drop the PTY, remove the session; unknown id is not an error. `Drop for Terminals` kills every child (app exit).
- Blocking work (spawn, write) runs on `tauri::async_runtime::spawn_blocking` or `std::thread`, never on the async runtime thread. Nothing is logged (terminal input can contain secrets).

## Tests (unix-only where they spawn processes: `#[cfg(unix)]`)

`shell_command` table for unix and windows inputs; UTF-8 carry decoder (split 2-, 3-, 4-byte sequences across reads, invalid byte); open `/bin/sh` in a temp dir, write `echo gittrunk-$((40+2))\n`, receive output containing `gittrunk-42` within 5 s; `pwd` prints the temp dir; resize succeeds; `exit 3` produces `TerminalExit` with `Some(3)`; close kills a running `sleep 30` and the session count drops; bad cwd -> `InvalidInput`; write to a closed id -> `InvalidInput`.

## Prove it

```bash
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/home/user/gittrunk/src-tauri/target
cd <worktree>/src-tauri && cargo fmt --all --check && cargo clippy --all-targets -- -D warnings \
  && cargo clippy --all-targets --features embedded-git -- -D warnings \
  && cargo test terminal && cargo test && cargo test --features embedded-git
cargo tree --target aarch64-linux-android -i portable-pty; echo "expect failure: $?"
cd .. && pnpm install --frozen-lockfile && pnpm bindings && git diff --exit-code src/ipc/bindings.ts
```

Windows compilation is proven by CI only; keep Windows-specific code minimal and behind `cfg(windows)`.

## Acceptance criteria

- Tests green; bindings unchanged; no new dependencies; no process left behind after the test run (`pgrep -f gittrunk-42` empty).
- The Android cfg path compiles in principle: no `portable_pty` symbol outside `cfg(not(target_os = "android"))`.

## Commits

`feat(terminal): run shells in a pseudo-terminal and stream output`, `test(terminal): cover sessions, resize, exit and UTF-8 carry`.

## Out of scope / needs orchestrator

Shell profiles, per-user shell setting, multiple terminals UI, Android.
