# PV: `/preview` mocked-IPC route and screenshot script

- Wave: 1
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/dev-preview`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.2 (Visual review harness); code: `src/main.tsx`, `src/ipc/bindings.ts` (every command and event, to mock them), `src/app/testing.tsx` (`installBackend` fixtures, as a model of realistic data), `src/stores/repo.ts`, `node_modules/@tauri-apps/api/mocks.d.ts` (`mockIPC`, `mockWindows`, `clearMocks`; `shouldMockEvents`).
- Frontend only. Playwright is installed globally (`/opt/node22/lib/node_modules/playwright`, Chromium in `/opt/pw-browsers`); do not add it to `package.json`.

## Goal

Render the real app in a normal browser with a fake backend, so the redesign can be screenshotted and reviewed (desktop dark/light at 1400x900, compact at 390x844) without building Tauri.

## Owned files

`src/main.tsx` (a dev-only branch), new `src/dev/preview/**` (`install.ts`, `fixtures.ts`, `handlers.ts`, `preview.test.ts`), new `scripts/preview-shots.mjs`.
Must NOT touch anything else.

## Behavior

- `src/main.tsx`: wrap the existing render in `async function boot()` called with `void boot()` (no top-level `await`: the build targets `safari13`/`chrome105`); inside, when `import.meta.env.DEV && location.pathname === "/preview"`, `await import("./dev/preview/install")` and call `installPreview(new URLSearchParams(location.search))` before rendering the normal tree. Production builds contain no preview code (verify: `pnpm vite build` output has no `dev/preview` chunk and no fixture strings).
- `install.ts`: `mockWindows("main")`; `mockIPC(handler, { shouldMockEvents: true })`; seeds `localStorage` for layout from params; after first render opens the fixture repo (`useRepoStore.getState().addRepo(fixtureRepoInfo)`) unless `?repo=0`.
- `handlers.ts`: a handler for **every** command in `bindings.ts` (snake_case names), returning fixture data or `null`; unknown commands throw so drift is visible. Mutations resolve with plausible outcomes (e.g. `undo` preview) without changing fixtures.
- `fixtures.ts` (deterministic, no randomness): repo "gittrunk" with ~300 commits across 5 lanes (merges and branch-offs), refs (`main` as HEAD, 3 local, 6 `origin/*`, 2 tags, 1 stash) and matching `refColors`; status with 6 unstaged files in nested folders, 2 staged, 1 conflicted when `?conflict=1`; commit details and diffs for any oid (synthesized); `avatarsGet`: inline SVG data URLs (colored circle with initials) for half the authors and `null` for the rest; `oplogState` can undo and redo; forge: GitHub repo `R4ph3rd/gittrunk`, token source `forge`, 12 issues (open/closed, labels, comments), issue detail with 3 comments (one containing `<b>html</b>` to show it stays text), commit comments for HEAD; `terminalOpen` returns an id and emits a short fake prompt/output via the mocked event system; `platformInfo` desktop, or Android capabilities with `?platform=android`; settings with `theme` from `?theme=dark|light`.
- Query params: `platform`, `theme`, `repo`, `panels=sidebar,bottom,right` (layout visibility), `center=graph|diff|worktree|issues|issue|new` (opens that center view after load), `right=commit|changes`, `select=<row index>`, `conflict`.
- `scripts/preview-shots.mjs`: `node scripts/preview-shots.mjs [--base http://localhost:1420] [--out <dir>]` (default out: `$TMPDIR/gittrunk-preview`), resolving Playwright from `NODE_PATH` or `/opt/node22/lib/node_modules/playwright`; captures: `desktop-dark-graph`, `desktop-light-graph`, `desktop-dark-hover-card` (hover a row 700 ms), `desktop-dark-changes-tree` (right=changes, tree mode via localStorage), `desktop-dark-diff-center`, `desktop-dark-worktree-diff`, `desktop-dark-issue`, `desktop-dark-terminal`, `desktop-dark-toolbar-menu` (open the Undo options menu), `desktop-light-issues`, `compact-history`, `compact-issues`, `compact-issue`, `compact-more` (Android platform), `compact-commit`; prints the file list; exits non-zero on console errors from the page.

## Tests

`preview.test.ts`: every key of `commands` in `bindings.ts` maps to a handler (convert camelCase to snake_case); fixture graph rows are consistent (edges reference existing lanes, `refColors` cover every non-stash ref); handlers return data that type-checks against the binding types (use `satisfies` in fixtures).

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm vite build && ! grep -rl "R4ph3rd/gittrunk" dist/assets; echo "preview absent from dist: $?"
(pnpm dev --port 1420 &) ; sleep 5; node scripts/preview-shots.mjs --out /tmp/claude-preview; echo "shots exit=$?"
```

Look at the screenshots yourself (Read tool) and describe what you see in the report; with Wave 1 UI packages not yet merged they show the old UI with the new palette, which is expected.

## Acceptance criteria

- `/preview` renders the desktop shell with the fixture repo without console errors; `?platform=android` at 390x844 renders the mobile shell.
- No preview code or fixtures in the production bundle.
- The script produces all listed screenshots (views not implemented yet may show stubs; the script must not fail on missing optional elements, only on page errors).

## Commits

`feat(dev): preview route with a mocked IPC backend`, `feat(dev): screenshot script for visual review`.

## Out of scope / needs orchestrator

Committing screenshots, CI integration of the screenshot script.
