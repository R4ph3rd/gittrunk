# gittrunk

A fast, native desktop Git client. An alternative to GitKraken built with Tauri 2 (Rust + libgit2) and React.

> Status: milestone M0 (scaffold). See [docs/PLAN.md](docs/PLAN.md) for the roadmap.

## Features (planned)

- Full Git coverage: clone, fetch, pull, push, branches, merge, rebase (interactive), cherry-pick, revert, reset, stash, tags, submodules, worktrees, conflict resolution, blame, file history, reflog
- Commit graph that stays smooth on 100k+ commit repositories
- Drag and drop merge, rebase, cherry-pick and ref moves, each with a preview and undo
- Multiple remotes (GitHub, GitLab, Bitbucket, self-hosted) using your system Git credentials
- Hunk and line staging with split and unified diffs
- Optional AI assistance (Anthropic by default, provider-agnostic), off unless you enable it

## Prerequisites

- Node.js 22+ and pnpm 10+ (`corepack enable`)
- Rust stable (`rustup`)
- Git on `PATH`
- Platform dependencies for Tauri 2:
  - **Windows**: Microsoft C++ Build Tools, WebView2 (preinstalled on Windows 10/11)
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

Full Windows instructions: [docs/BUILD.md](docs/BUILD.md).

## Develop

```sh
pnpm install
pnpm tauri dev        # runs Vite and the Tauri app with hot reload
```

`pnpm tauri dev` regenerates `src/ipc/bindings.ts` from the Rust contract on each debug start. To regenerate without launching the app, run `pnpm bindings`.

## Quality checks

```sh
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
cd src-tauri && cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## Build

```sh
pnpm tauri build                      # installers for the current platform
pnpm tauri build --bundles nsis,msi   # Windows: .exe + NSIS setup + MSI
```

Output lands in `src-tauri/target/release/` (app binary) and `src-tauri/target/release/bundle/` (installers).

## Branches and releases

- `main` holds only clean, releasable code.
- Work happens on feature/integration branches and reaches `main` through pull requests.
- Pushing a `v*` tag on `main` runs `.github/workflows/release.yml`, which builds Windows, macOS and Linux installers and creates a draft GitHub Release.
- Every push to `main` or a development branch runs `Build Windows`, which uploads the `.exe`, NSIS installer and MSI as workflow artifacts.

## Documentation

- [docs/PLAN.md](docs/PLAN.md): milestones and agent workflow
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): modules and IPC contract
- [docs/BUILD.md](docs/BUILD.md): building Windows installers
- [docs/DESIGN.md](docs/DESIGN.md): design tokens and components
