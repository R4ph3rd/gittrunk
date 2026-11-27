# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## Project

gittrunk is a fast, native Git client: Tauri 2 (Rust backend) + React 19 / TypeScript / Vite / Tailwind v4 (WebView frontend).

- **Targets:** Windows (primary), macOS, Linux, and Android. Android is read-only: you can view, follow, comment, and open issues and PRs, but not commit or stage.
- **Repo:** `R4ph3rd/gittrunk`.
- **Branches:** `main` is release-only and must always be green. Day-to-day work happens on a feature/dev branch, which reaches `main` by fast-forward.
- **More docs:**
  - `docs/ARCHITECTURE.md`: module map and IPC flow. Read it first.
  - `docs/DESIGN.md`: design tokens and components.
  - `docs/BUILD.md`: building, e2e, Android.
  - `docs/RELEASING.md`: release pipeline and signing.
  - `docs/PLAN.md`: milestones and ownership.
  - `docs/MOBILE_DESIGN.md` and `docs/ANDROID_PLAN.md`: Android.

## Layout

```
src/                     React app
  app/                   shell, layout, commands/palette, shortcuts, platform.ts, mockBindings.ts
  design/                tokens.css, components (import from "@/design/components"), MeshBackdrop
  features/<area>/       graph, staging, remotes, forge (issues/PRs), home, settings, history-views, …
  ipc/                   bindings.ts (GENERATED), client.ts (unwrap), queries.ts (TanStack Query hooks)
  stores/                Zustand stores
  dev/preview/           /preview route fixtures + command handlers (browser-only preview of the app)
  test/setup.ts          Vitest setup (fails tests on React act() warnings)
src-tauri/src/
  ipc/types.rs           every type crossing IPC (serde + specta): the contract
  ipc/error.rs           AppError { kind, message, detail } with a closed ErrorKind set
  ipc/mod.rs             command/event registry + TS export
  commands/*.rs          thin handlers, blocking work on spawn_blocking
  git/                   libgit/ (git2 reads), cli/ (git CLI runner), remote/, staging/, oplog/ (undo), …
  forge/                 Forge trait + GitHub implementation (issues, PRs, notifications, repo creation)
  settings/, ssh/, terminal/, avatars/, ai/
e2e/                     tauri-driver end-to-end specs (node e2e/run.mjs)
scripts/                 bump-version.mjs, check-version.mjs, android helpers
.claude/agents/          subagent definitions (orchestrator, rust-git-agent, frontend-agent,
                         design-system-agent, build-agent, ai-agent, checker)
```

## Commands

Toolchain: Node 22, pnpm 10 (via Corepack), stable Rust (MSRV 1.80). On Linux you also need the Tauri system dependencies: `libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev`.

```sh
pnpm install --frozen-lockfile
pnpm dev                 # Vite only (browser); /preview renders the app on fixtures
pnpm tauri dev           # full desktop app
pnpm bindings            # regenerate src/ipc/bindings.ts from the Rust contract
pnpm e2e                 # end-to-end (needs a built app + tauri-driver; xvfb-run on Linux)
```

### Quality gate (run all before pushing; CI runs the same)

```sh
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm bindings && git diff --exit-code src/ipc/bindings.ts
cd src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo clippy --all-targets --features embedded-git -- -D warnings
cargo test
cargo test --features embedded-git
```

`embedded-git` emulates the Android build on desktop (no git CLI, a libgit2-only shim). Both feature sets must compile and pass.

## Rules and conventions

### IPC contract

- **Adding or changing a command:**
  1. Define its types in `ipc/types.rs`.
  2. Add the handler in `commands/<area>.rs`.
  3. Register it in `ipc/mod.rs` and `commands/mod.rs`.
  4. Run `pnpm bindings` and commit the regenerated `src/ipc/bindings.ts`.
  5. Update `src/app/mockBindings.ts` (test mocks) and `src/dev/preview/handlers.ts` (preview).
- **Never hand-edit `bindings.ts`.** Never call `invoke(` directly; use `commands.*` through `unwrap()` and the hooks in `ipc/queries.ts`.
- **Errors:** errors are `AppError` with an `ErrorKind`. Never put tokens, passwords or credential URLs in error messages or logs.

### Platforms

- **Gating:** gate features through `src/app/platform.ts` flags (`readOnly`, `hasGitCli`, `supportsSsh`, `supportsExternalEditor`, …). Write actions are hidden when `readOnly`.
- **Rust cfgs:** Rust uses the `embedded_git` cfg (Android, or `--features embedded-git`). Desktop-only crates such as `ssh-key` and `portable-pty` live in non-Android dependency tables.
- **Windows file names:** Windows has a case-insensitive filesystem, so no two module paths may differ only by case (`FileTree.tsx` vs `fileTree.ts` once blanked the app). CI checks for this.
- **Windows manifest:** `build.rs` embeds the Common Controls manifest through the linker for every binary, tests included. Don't remove it.

### Frontend

- **Design tokens:** no hex/rgb literals outside `src/design/tokens.css`; use token classes or `var(--token)`. Use design-system components, and respect `prefers-reduced-motion` (`motion-safe:`).
- **Toasts:** go through `toast` from the design system's `Toaster.tsx`. It also records them as notifications; don't import `sonner` directly.
- **Accessibility:**
  - Text must meet WCAG AA contrast; `src/design/contrast.test.ts` enforces it, including for the backdrop.
  - Every interactive element must have an accessible name and a visible focus ring.
- **Test setup:** tests fail on React `act()` warnings. Drive state changes inside `act`/`userEvent` and await the settled UI.
  - `src/test/setup.ts` already spies on `console.error`. Reuse it with `vi.mocked(console.error)`; don't create a new spy or call `mockRestore`.

### Backend

- Keep `commands/*` thin; put logic in `git/`, `forge/` and similar modules, with fixture-repo tests next to it.
- Validate that user-supplied paths stay inside the repo.
- Long-running network ops (fetch, pull, push, clone) run as ops with progress events and cancellation. Background ones (auto-fetch) are quiet and never prompt for credentials.
- Tests must not depend on machine speed. Pass generous timeouts or grace periods, because the Windows CI runners are slow.

### Commits

- **Format:** Conventional Commits (`feat(scope): …`, `fix(…)`, `test(…)`, `docs(…)`, `ci(…)`, `chore(release): x.y.z`).
- **Author:** the repository owner, `R4ph3rd <43202876+R4ph3rd@users.noreply.github.com>`. Never write a personal email address into the repo or commit metadata.
- **Agent commits** use Claude as committer and the owner as author:

  ```sh
  git -c user.name=Claude -c user.email=noreply@anthropic.com \
    commit --author="R4ph3rd <43202876+R4ph3rd@users.noreply.github.com>"
  ```

- **Never commit:** secrets, signing material, or build output (`src-tauri/target`, `dist`, keystores, certificates).

## CI and releases

- **Workflows:** `ci.yml` (checks on Ubuntu and Windows, plus E2E), `build-windows.yml`, `build-android.yml` (APK plus an emulator smoke test) and `release.yml`.
- **Automatic releases:** every push to `main` is released once CI, Build Windows and Build Android have all passed for that commit.
  - The version comes from `src-tauri/tauri.conf.json`. If that version is already tagged, the next patch is released and stamped in at build time.
  - For a minor or major release, run `node scripts/bump-version.mjs X.Y.Z` and `cargo update -p gittrunk --manifest-path src-tauri/Cargo.toml`, then commit `chore(release): X.Y.Z`.
- **Release contents:** Windows (NSIS, MSI), macOS (universal DMG), Linux (deb, rpm, AppImage) and an Android universal APK. The draft is published only when every asset exists.
- **Signing:** comes only from repository secrets (Windows, Apple, and `ANDROID_*`); builds are unsigned without them. See `docs/RELEASING.md`.
- **Pushing to `main`:** fast-forward only, after the same commit is green on the dev branch. Never force-push `main`.

## Working with subagents

Larger work follows a plan/build/check loop, using the agents in `.claude/agents/`:

1. The orchestrator writes a plan in `docs/PLAN.md` and per-task dispatches in `docs/dispatch/<milestone>/`.
2. Builders work in isolated worktrees on disjoint files; shared contract changes land first.
3. The `checker` runs the full gate and integration review before anything reaches `main`.
