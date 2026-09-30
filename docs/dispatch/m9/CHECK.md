# CHECK: M9 integration gate, visual review and fixer

- Wave: 2 (after every Wave 1 package is merged; D9 runs in parallel and only edits `docs/ARCHITECTURE.md` and `README.md`)
- Agent: `checker`, model **opus**
- Branch/worktree: `fix/m9-check`, from the integration branch HEAD after Wave 1
- Read first: `docs/dispatch/m9/COMMON.md` (and the Android COMMON it extends), `docs/PLAN.md` §12, every brief in `docs/dispatch/m9/` (their acceptance lists are your checklist), the screenshot the plan answers (described in §12.1).

## Fix policy

Fix small integration issues yourself: wiring between packages, cherry-pick leftovers in shared tests, a missed `readOnly` gate, a token misuse, a selector the e2e needs, formatting, a flaky assertion. Larger problems, or anything that changes a contract (`src-tauri/src/ipc/**`, bindings, `queries.ts` hook shapes, `stores/{layout,workspace,nav}.ts` shapes, design component props), go back as a failure report naming the package, file, failing command and a proposed fix. Commit fixes as `fix(<scope>): ...` with the COMMON trailers; never push; never edit `docs/ARCHITECTURE.md`/`README.md` (D9) or `docs/PLAN.md` (orchestrator).

## 1. Full gate

```bash
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/home/user/gittrunk/src-tauri/target
cd <worktree>/src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo clippy --all-targets --features embedded-git -- -D warnings
cargo test
cargo test --features embedded-git
cargo tree --target aarch64-linux-android -i portable-pty      # must not resolve
cargo tree --target aarch64-linux-android -i keyring           # must not resolve
cd .. && pnpm install --frozen-lockfile
pnpm bindings && git diff --exit-code src/ipc/bindings.ts
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
node --test scripts/check-version.test.mjs scripts/android/customize.test.mjs && node scripts/android/customize.mjs --check
pnpm build
pnpm tauri build --debug --no-bundle && xvfb-run -a -s "-screen 0 1400x900x24" pnpm e2e
```

If disk is too tight for the debug build, say so and rely on CI's `E2E tests` job. Record exit codes in the report.

## 2. Cross-package review (read code, not only tests)

- **Contracts**: bindings unchanged since C0 except by C0; every UI call of the new commands matches the Rust signatures; stubs from C0 replaced (no `data-testid="forge-main-view"` placeholder left, `IssuesPlaceholder` removed, `TerminalPanel` real); `NotImplemented` no longer returned by any M9 command (`grep -rn not_implemented src-tauri/src/commands`).
- **Layout and routing**: panel toggles and shortcuts (`mod+b`, `mod+j`, `mod+alt+b`) work and persist; the graph stays mounted across center views; Escape/back behavior; right panel auto-switch; working-copy diff falls back correctly when a file changes side; closing a repo forgets its workspace and kills its terminal.
- **Graph**: refs column left of lanes, connector lines, avatar nodes with initials fallback, merge nodes, HEAD halo, hover card (delay, copy buttons, full message, keyboard `Alt+Enter`), no author/date/oid columns, sr-only row text; compact rows unchanged; perf: scrolling a 100k-row graph still renders only visible rows (existing test) and avatar requests are batched (one `avatarsGet` per visible window).
- **Colors**: `RefBadge` lane colors in graph, commit details and mobile; sidebar icons use the same colors as the graph for the same ref; `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(" src --include=*.ts --include=*.tsx | grep -v "bindings.ts\|\.test\.\|src/dev/preview"` is empty; no Tailwind palette classes (`grep -rnE "\b(bg|text|border)-(zinc|gray|slate|neutral|red|rose|pink|teal|indigo|white|black)\b" src`).
- **Read-only**: with the Android platform (compact and regular layout) no write binding is reachable. For each of `stagePaths`, `unstagePaths`, `discardPaths`, `stageLines`, `commitCreate`, `stashSave`, `stashApply`, `stashDrop`, `branchCreate`, `branchDelete`, `branchRename`, `tagCreate`, `tagDelete`, `refMove`, `merge`, `rebase`, `rebaseInteractive`, `cherryPick`, `revert`, `reset`, `push`, `remoteAdd`, `remoteRemove`, `remoteRename`, `remoteSetUrl`, `undo`, `redo`, `aiPlanExecute`: list its UI call sites and confirm each is behind a `readOnly` gate or unreachable on Android. `pull` uses `ffOnly` when read-only.
- **Forge security**: tokens never cross IPC (no command returns a token; `forge_token_source` returns only the source); no token, `Authorization` header or credentialed URL in logs or error strings (`grep -rn "println!\|eprintln!\|log::" src-tauri/src/{forge,avatars,terminal}`); forge content rendered as text only (`grep -rn dangerouslySetInnerHTML src` empty); writes without a token never hit the network (R-FORGE test).
- **Avatars**: `Off` mode makes no requests; the webview never loads remote images (`grep -rn "https://" src --include=*.tsx | grep -v "docs\|test"` shows no image sources); CSP in `src-tauri/tauri.conf.json` unchanged (`img-src 'self' data: asset: http://asset.localhost`, `connect-src ipc: http://ipc.localhost`); disk cache under the app cache dir.
- **Terminal**: sessions killed on repo close and app exit; the PTY code is behind `cfg(not(target_os = "android"))`; no terminal input/output logged; xterm is not in the entry chunk (`pnpm build` output).
- **Oplog**: undo/redo buttons reflect `oplog_state`; multi-step undo then redo restores in order (R-CORE test plus a manual check in the preview if possible).
- **a11y**: every icon-only button has `aria-label` and a tooltip; tabs use `role="tab"`/`aria-selected`; toggles `aria-pressed`; the file tree uses `tree`/`treeitem` with `aria-expanded`; the hover card content is reachable by keyboard; focus rings visible (`--focus-ring`) in both themes; `src/design/contrast.test.ts` green.

## 3. Visual review with the preview harness

```bash
pnpm dev --port 1420   # background
node scripts/preview-shots.mjs --out /tmp/m9-shots
```

Open every screenshot (Read tool) and check against §12.1: tabs visually merge into the toolbar (item 1); Undo split button left of Fetch, Branch and Stash after Push (2); avatars in commit details (3); ref chips colored like their lane in the graph, commit details and sidebar (4); layout toggles top right, terminal panel, right panel tabs (5); list/tree toggle at the top of Unstaged (6); staged vs unstaged blocks clearly separated (7); pinky-red accent, neutral non-blue dark surfaces, coherent light theme (8); Issues in the sidebar and mobile Issues tab, no write actions in mobile More/History/Branches (9); avatar nodes, no author column (10); ref labels left of the lanes (11); no date/oid columns, hover card with date, oids and full message (12); diffs in the center with a back affordance (13). Also check compact screenshots at 390x844 for overflow, truncation and touch target sizes. Fix small visual defects (spacing, token misuse, truncation); report design-level issues with the screenshot name.

## 4. CI

After the main session pushes the merged branch: `CI` (Linux and Windows legs, embedded-git steps, bindings drift), `E2E tests`, `Build Windows` (proves `portable-pty` on ConPTY compiles), `Build Android` (proves the Android graph without `portable-pty`). Iterate as in `docs/dispatch/android/CHECK.md` "Iterating on CI" (one hypothesis per push, the main session relays logs).

## Report back

1. Gate table (command, exit code).
2. Per-package PASS/FAIL against each brief's acceptance list.
3. Visual review: one line per screenshot, issues found, fixes made.
4. Fixes committed (hash, one line each).
5. Failures returned to owners (package, file, command, proposed fix).
6. CI runs (workflow, run id, conclusion).
7. Anything the maintainer must decide or provide (GitHub token for a live test, avatar default).
