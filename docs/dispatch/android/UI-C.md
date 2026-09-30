# UI-C: History, commit detail, branches, remotes, clone and action sheets on mobile

- Wave: 3 (parallel with UI-B)
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/mobile-ui-c-history`
- Read first: `docs/dispatch/android/COMMON.md`, `docs/PLAN.md` §11, `docs/MOBILE_DESIGN.md` §2 v1 scope table, §3.1, §3.2, §3.3, §3.6, §4 (long-press, drag and drop, graph canvas, pull-to-refresh), §6, §7 package C; merged contracts: `src/stores/nav.ts`, `src/app/layout/{registry.ts,ShellAppBar.tsx}` (UI-A), `src/design/components` + `src/design/hooks` (UI-D), `src/app/layout/useLayout.ts`, `src/test/viewport.ts` (S0), `src/app/platform.ts` (R0).
- Frontend only: no cargo.

## Goal

On compact layouts, History is a touch-friendly two-line commit list with a lane gutter, commits open a detail page, branches/remotes/tags are segmented pages with action sheets, every context menu becomes a long-press action sheet driven by the same registry as desktop, drag and drop is inert, and cloning works over HTTPS with a token into app storage. Capability flags hide what the platform cannot do (on every layout). Desktop rendering and draw calls are unchanged.

## Owned files

- `src/features/graph/**` (+ new `metrics.test.ts`)
- `src/features/repo/{CommitDetailsPanel,RefsSidebar,SidebarParts,RepoView,FileDiffView}.tsx`, new `src/features/repo/mobile/{HistoryScreen,CommitScreen,CommitFileScreen,BranchesScreen,RefRow}.tsx`, `src/features/repo/mobile/mobile.test.tsx`, and `src/features/repo/mobile/contrib.ts` (stub by UI-A; replace the body, keep `export const repoScreens: ScreenContribution`)
- `src/features/operations/{actions,dnd,preview,rebase}/**`, `src/features/operations/{OperationsHost.tsx,queries.ts,testing.ts}`
- `src/features/remotes/**`, `src/features/history-views/**`
- `src/stores/{dnd,operations,remotes}.ts`

Must NOT touch: `src/features/{staging,stash,ai}/**`, `src/features/operations/{conflicts,sequencer}/**` (UI-B), `src/features/repo/{Welcome,RepoTabs,StatusBar,useOpenRepo}.tsx`, `src/features/settings/**`, `src/features/ops/**`, `src/app/**`, `src/stores/nav.ts`, `src/design/**`, `src/ipc/**`, `src/index.css`. Existing tests (`draw.test.ts`, `layout.test.ts`, `pages.test.ts`, `dnd.test.tsx`, `operations.test.tsx`, `history-views.test.tsx`, `remotes.test.tsx`, `App.test.tsx`) must pass without edits.

## Contract with the shell

`repoScreens` provides:

```ts
tabs:   { history: HistoryScreen, branches: BranchesScreen }
routes: { commit: CommitScreen, commitFile: CommitFileScreen, fileHistory: <FileHistory page>, reflog: <Reflog page> }
```

Each screen renders `<ShellAppBar …/>` at its top. Navigation via `useNav()`. The WIP row calls `setTab("changes")` (UI-B owns that tab). `CommitFileScreen` reuses UI-B's `DiffViewer`, which forces unified mode on compact by itself.

## Behavior (MOBILE_DESIGN references)

- Graph metrics (§3.2): introduce `GraphMetrics` (row height, lane pitch, node radius, DPR cap) in `layout.ts`/`draw.ts` with the current values as defaults so desktop draw calls are identical; compact uses `ROW_HEIGHT_COMPACT = 56`, lane pitch 14, node radius 4, `Math.min(devicePixelRatio, 2.5)`, overscan 8, lane gutter capped at 40% width.
- HistoryScreen: two-line rows (subject; author, relative time, short hash in mono, ref chips that wrap), search/filter in the AppBar (`FilterPopover` content in a `Sheet`), `PullToRefresh` triggers the existing fetch action, WIP row => `setTab("changes")`, tap => push `commit`, long-press (`useLongPress`, 450ms) => commit `ActionSheet`, plus a visible overflow button on coarse pointers. AppBar overflow: Fetch, Pull, Push (existing remote actions).
- CommitScreen (§3.3): subject, collapsible body, author/date, tappable parent chips (push `commit`), AI summary button when enabled, file list rows => push `commitFile`; overflow = commit action sheet.
- BranchesScreen (§3.6): `SegmentedControl` Local / Remotes / Tags, search field, rows 52px with current-branch accent dot and ahead/behind, tap or long-press => ref `ActionSheet`; "+" new branch; fetch; remotes add/edit via `RemoteFormDialog` as `ResponsiveDialog`.
- Action registry (§4): `ActionMenu`/`openMenu` render `ActionSheet` on compact from the same `buildActionEntries` output (no separate list). On any layout, filter entries by capability: `interactiveRebase` hidden when `!supportsInteractiveRebase`, `rebase` entries hidden when `!supportsRebase`. Menu-driven "Merge into current…", "Rebase onto…", "Cherry-pick" use the existing `resolve.ts` -> preview -> `ConfirmDialog` pipeline; `ConfirmDialog` becomes a full-height sheet on compact via `ResponsiveDialog`.
- DnD (§4): `OperationsProvider` registers no sensors and `useDndNode` returns inert props when `isCompact`; desktop unchanged.
- Clone (§3.1) in `CloneDialog` (compact sheet via `ResponsiveDialog`; logic applies on any layout when the capability says so): when `defaultReposDir` is set, destination is `${defaultReposDir}/${name}` (editable name, no folder picker when `!canPickFolder`); when `!supportsSsh`, only `https://` URLs validate, with the message "Use an HTTPS URL and a personal access token"; optional Username + Token fields that call `commands.credentialStore({ host, username, secret })` before starting the clone; clipboard paste chip; progress with cancel; open the repo on success as today.
- `CredentialPrompt`, `PushDialog`, `SetUpstreamDialog`: `ResponsiveDialog`; token field labelled "Personal access token" when `!supportsSsh`.
- History views: reflog and file history as plain list pages on compact (`reflog`, `fileHistory` routes); blame hidden on compact; on any layout hide worktree actions/sections when `!supportsWorktrees`, submodule update/init when `!supportsSubmodules`, file history entry points when `!supportsFileHistory`.

## Tests

`src/features/repo/mobile/mobile.test.tsx` and `src/features/graph/metrics.test.ts`, at `setViewport(390, 844)` with `installBackend()` unless noted:
history rows render the two-line layout with ref chips; tap pushes `commit`; long-press (fake timers) opens an ActionSheet whose item ids equal `buildActionEntries(...)` ids for the same target; pull-to-refresh calls the fetch binding; WIP row switches to Changes; Branches segmented control switches Local / Remotes / Tags; no dnd sensors when compact; `GraphMetrics` defaults equal the old constants and desktop draw output is unchanged (existing `draw.test.ts` untouched and green); with Android platform mocked: interactive rebase and rebase entries absent, worktree sections absent, clone destination under `defaultReposDir`, `ssh://` URL rejected, token fields call `credentialStore` before `repoClone`; with desktop mocks everything as before.

## Commits

`feat(graph): parameterize graph metrics for compact rows`, `feat(mobile): add History and commit detail screens`, `feat(mobile): add Branches screen and long-press action sheets`, `feat(mobile): clone over HTTPS with a token into app storage`, `feat(mobile): hide unsupported git features by platform capability`.

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm vite build
```

## Acceptance criteria

- All tests above pass; all existing suites pass unchanged at the default viewport.
- Desktop graph draw calls identical (existing draw/layout tests untouched and green).
- Only owned files changed; no new dependencies; no raw colors.

## Out of scope / needs orchestrator

Drag and drop on touch, interactive rebase editor on touch, blame on compact (v2), SAF folder picking.
