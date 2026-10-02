# CHECK: M10 integration gate, visual and accessibility review, fixer

- Wave: 2 (after C10 and every Wave 1 task is merged; D10 runs in parallel and only edits `docs/ARCHITECTURE.md` and `README.md`)
- Agent: `checker`, model **opus**
- Branch/worktree: `fix/m10-check`, from the integration branch HEAD after Wave 1
- Read first: `docs/PLAN.md` §13 and every brief in `docs/dispatch/m10/` (their acceptance lists are your checklist).

## Fix policy

Fix small integration issues yourself: wiring between tasks (Home buttons opening the real dialogs, the tab strip mounting the real `NotificationsButton`, `MeshBackdrop` honoring the setting on both mounts), leftovers in shared tests, a missed `readOnly`/`supportsSsh` gate, token misuse, an e2e selector, formatting, flaky assertions. Larger problems, or anything that changes a contract (`src-tauri/src/ipc/**`, bindings, hook shapes in `queries.ts`, store shapes, `MeshBackdrop` props), go back as a failure report naming the task, file, failing command and a proposed fix. Never edit `docs/PLAN.md`, `docs/ARCHITECTURE.md` or `README.md`.

Commits: `fix(<scope>): ...` made with
`git -c user.name=Claude -c user.email=noreply@anthropic.com commit --author="R4ph3rd <43202876+R4ph3rd@users.noreply.github.com>" -F - <<'EOF' ... EOF`, ending with a blank line and exactly:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FzHMmoKCskK5U6Gdp6AZmv
```

Never push.

## 1. Full gate

```bash
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/home/user/gittrunk/src-tauri/target
cd <worktree>/src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo clippy --all-targets --features embedded-git -- -D warnings
cargo test
cargo test --features embedded-git
cargo tree --target aarch64-linux-android -i ssh-key        # must not resolve
cargo tree --target aarch64-linux-android -i portable-pty   # must not resolve
cd .. && pnpm install --frozen-lockfile
pnpm bindings && git diff --exit-code src/ipc/bindings.ts
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm build
pnpm tauri build --debug --no-bundle && xvfb-run -a -s "-screen 0 1400x900x24" pnpm e2e
```

## 2. Behavior review (run the app or `/preview`)

- `+` opens a New tab (no folder picker), with Open / Clone / Create repository and ≤ 10 recents; opening one replaces the placeholder; `mod+t`, `mod+w` work.
- Wordmark → Home: actions, workspaces (create, open all, edit, delete), Recently opened, All repositories (missing flag, Remove from list); the open repository keeps its graph scroll and terminal after returning.
- Tab strip right end: layout toggles, divider, Notifications, Settings; toggles hidden on Home/new tab.
- Graph backdrop: visible but faint in dark and light, X-dominant parallax while scrolling 100k rows (`/preview` or the perf fixture) without dropped frames in the Performance panel; static with reduced motion emulated; gone when the setting is off.
- Pull requests: sidebar section above Issues, chips in lane colors, list filters, detail, Open on GitHub (opens the browser), checkout paths (local, tracking, fetch then checkout, fork hidden), comments; compact Issues tab switch and `pull` route; Android platform: view, comment, checkout present, no other git writes.
- Notifications: toasts appear in Activity with the repo name; GitHub tab with and without token; fine-grained token message.
- Settings: SSH keys (list, copy, generate with and without passphrase, files 0600 on Linux, refuses overwrite), Integrations cards (GitLab "Coming soon"), Background gradients switch, About link opens the browser.

## 3. Screenshots

Extend `scripts/preview-shots.mjs` only if needed (it belongs to build-agent; small additions are fine) and capture: Home (dark, light), new tab, graph with backdrop (dark, light), PR detail, notifications popover, Settings > SSH keys, compact Issues > Pull requests. Review contrast visually against the test's guarantees.

## 4. Security and accessibility review

- `grep -rn dangerouslySetInnerHTML src/` is empty; PR/notification text is plain.
- `app_open_url` refuses non-allowlisted URLs (try `http://`, `file://`, a lookalike host from devtools); no capability was added for the opener (`src-tauri/capabilities/*.json` unchanged).
- No passphrase or token in logs, toasts, notifications or errors; private key files are never read.
- axe-style pass on Home, popover and SSH section: labels, focus order, `Esc` closes popovers/dialogs, visible focus rings, badges not color-only.

## 5. CI

Push is done by the main session; after it, watch `CI`, `E2E tests`, `Build Windows` and **`Build Android`** (the opener plugin adds Android native code). If Android fails because of the plugin and cannot be fixed in a few attempts, report it with the fallback from PLAN §13.8 (move `tauri-plugin-opener` to the non-Android table, `app_open_url` returns `Unsupported` on Android, the UI keeps Copy link) for the orchestrator to apply.

## Report

Gate results (command, exit code), checklist results, fixes made (commit, why), failure reports for tasks, screenshots reviewed, CI status.
