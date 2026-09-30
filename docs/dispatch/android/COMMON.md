# Android (M8) dispatch: common rules for every builder

Every brief in this directory assumes you have read this file. Your brief wins if it says something more specific.

## Where you are

- Repo: gittrunk, a Tauri 2 Git client (React 19 + TS + Vite + Tailwind v4 frontend, Rust backend with `git2` and the `git` CLI).
- You work in your own **git worktree** branched from the integration branch `claude/relaxed-allen-0mjwae` after the previous wave was merged. Several builders run at the same time in other worktrees. Touch **only** the files your brief lists as owned. If you need anything else changed (a contract type, `Cargo.toml`, `package.json`, `src/index.css`, another package's file), do not edit it: note it under "Needs orchestrator" in your report.
- Plans you implement: `docs/ANDROID_PLAN.md` (backend, CI, release) and `docs/MOBILE_DESIGN.md` (UI). Decisions that override those docs are in `docs/PLAN.md` §11 and in your brief.

## Environment facts

- There is **no Android SDK/NDK** locally (dl.google.com is blocked). crates.io, npm, maven.google.com and services.gradle.org are reachable. Java is installed. Android compilation is proven only on GitHub Actions (ubuntu runners have `ANDROID_HOME` and `ANDROID_NDK_LATEST_HOME`). Never try to install the NDK.
- Disk is limited (about 20 GB free; `src-tauri/target` is already large). Rust builders **must** export these before any cargo command and share the main checkout's target dir:

  ```bash
  export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/home/user/gittrunk/src-tauri/target
  ```

  Other builders may be compiling at the same time: "Blocking waiting for file lock" is normal, wait for it. Never run `cargo clean`.

- Frontend-only builders must **not** build Rust (no `cargo`, no `pnpm bindings`, no `pnpm tauri build`).
- In a fresh worktree run `pnpm install --frozen-lockfile` once before any pnpm script (the pnpm store is shared, this is fast). Do not add or upgrade dependencies.
- Shell cwd is reset between tool calls: use absolute paths, or `cd <worktree> && ...` in the same command.

## Git and commits

- Identity is preconfigured as `R4ph3rd <43202876+R4ph3rd@users.noreply.github.com>`. Do **not** run `git config` and do not pass `--author`.
- Conventional Commits with a required scope, e.g. `feat(android): ...`, `feat(mobile): ...`, `ci(android): ...`, `test(git): ...`. Use the messages suggested in your brief.
- Every commit message must end with exactly these two trailer lines (after a blank line):

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FzHMmoKCskK5U6Gdp6AZmv
  ```

  Use a heredoc: `git commit -F - <<'EOF' ... EOF`.

- Do not push, do not rebase onto other branches, do not merge. The main session merges your worktree branch.
- Commit only after your gates pass. Several small commits are fine; no fixup noise.

## Quality gates (run those relevant to the files you touched)

Script names are exactly these (see `package.json`):

```bash
# frontend (repo root of your worktree)
pnpm lint                 # eslint . --max-warnings=0
pnpm format:check         # prettier --check .   (fix with: pnpm prettier --write <files>)
pnpm typecheck
pnpm test; echo "vitest exit=$?"   # check the exit code, not the summary line

# rust (from <worktree>/src-tauri, with the exports above)
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo clippy --all-targets --features embedded-git -- -D warnings   # once R0 is merged
cargo test
cargo test --features embedded-git                                   # scope per brief

# IPC contract (only R0, or anyone whose brief says IPC types change)
pnpm bindings && git diff --exit-code src/ipc/bindings.ts
```

`pnpm format:check` covers Markdown, YAML and JSON too. Desktop behavior must stay unchanged: the full existing Rust and Vitest suites must keep passing without edits to existing assertions (annotation-only gating is allowed where a brief says so).

## Shared contracts (read-only unless your brief owns them)

- `src-tauri/src/ipc/**`, `src/ipc/bindings.ts` (generated, never hand-edited), `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `package.json`, `pnpm-lock.yaml`, `src/index.css`, `docs/PLAN.md`: orchestrator-owned; changed only by the package the orchestrator names.
- `src-tauri/src/platform.rs` (from R0): capability constants and `EMBEDDED`.
- `src/app/platform.ts` (from R0): `usePlatform()` capability flags for the UI.
- `src/app/layout/*` (from S0, then A): `useLayout()`, `LayoutProvider`, back-button stack.
- `src/test/viewport.ts` (from S0): `setViewport(w, h)` for tests.

Rule of thumb for the UI: **layout** (compact vs regular) comes from the viewport via `useLayout()`; **capabilities** (can pick a folder, SSH, worktrees, rebase, git CLI) come from `usePlatform()`. Never infer one from the other: an Android tablet is regular layout with mobile capabilities.

## Report back (final message)

1. Branch name and commit hashes.
2. Gate results (each command and its exit code).
3. What is done vs. the acceptance criteria, one line each.
4. Deviations from the brief and why.
5. "Needs orchestrator": contract/shared-config changes you needed but did not make.
6. Anything the checker should look at (risky spots, TODOs).
