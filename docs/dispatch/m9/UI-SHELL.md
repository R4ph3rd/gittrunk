# UI-SHELL: workbench layout, linked tabs, center router and right panel

- Wave: 1
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/shell-m9-workbench`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.1 items 1, 3, 5, 13 and §12.2 (Right panel, Layout); code: `src/app/App.tsx`, `src/features/repo/{RepoTabs,RepoView,StatusBar,CommitDetailsPanel,FileDiffView}.tsx`, `src/features/repo/useOpenRepo.ts`, `src/features/staging/{StagingPanel.tsx,effectiveOpen.ts}`, `src/features/staging/diff/DiffViewer.tsx` (props only), `src/app/commands/{builtin.ts,registry.ts}`, `src/design/components/{ResizablePanels,Tabs,Tooltip,IconButton}.tsx`; merged contracts: `src/stores/{layout,workspace}.ts`, `src/ipc/queries.ts` (`useAvatar`), `src/design/components/Avatar.tsx`, stubs `src/features/terminal/TerminalPanel.tsx`, `src/features/forge/{ForgeMainView,CommitComments}.tsx`.
- Frontend only.

## Goal

Turn the desktop shell into a workbench: browser-style repo tabs that merge into the toolbar, VS Code-like toggles for the sidebar, a bottom terminal panel and the right panel; a center area that shows the graph or, instead of it, a diff or an issue view with a way back; a right panel with Commit and Changes tabs; avatars in commit details.

## Owned files

Modify: `src/app/App.tsx`, `src/features/repo/{RepoTabs,RepoView,StatusBar,CommitDetailsPanel,FileDiffView}.tsx`, `src/features/repo/useOpenRepo.ts`, `src/features/staging/StagingPanel.tsx`, `src/app/commands/builtin.ts`; primary owner of `src/app/App.test.tsx`, `src/app/commands.test.tsx`, `src/features/staging/staging.test.tsx`.
Create: `src/app/shell/{LayoutToggles.tsx,CenterArea.tsx,CenterHeader.tsx,RightPanel.tsx,BottomPanel.tsx,workbench.test.tsx}`.
Must NOT touch: `src/features/remotes/**` (UI-TOOLBAR renders the toolbar row; keep mounting `<RemoteToolbar repoId />`), `src/features/repo/{RefsSidebar,SidebarParts}.tsx` (UI-SIDEBAR), `src/features/graph/**`, `src/features/staging/FileList.tsx`, `src/features/terminal/**`, `src/features/forge/**`, `src/stores/**`, `src/design/**`, `src/ipc/**`.

## Layout

```
┌ tab strip (bg-tabbar): logo · tabs … · [+] ··················· [sidebar][bottom][right] ┐
├ toolbar row (bg-toolbar = active tab bg): <RemoteToolbar/> (UI-TOOLBAR)                 ┤
├ sidebar │ center column                                   │ right panel                   ┤
│ (Refs)  │ CenterArea (graph | diff | issue views)         │ [Commit | Changes (n)]        │
│         ├ BottomPanel: <TerminalPanel repoId cwd/> (lazy) │ CommitDetailsPanel/StagingPanel│
├ status bar ─────────────────────────────────────────────────────────────────────────────┤
```

- **Tabs (item 1).** Tab strip `bg-tabbar`, height 36px. Each tab: rounded top corners, `role="tab"`, `aria-selected`; active tab `bg-tab-active text-fg` with a 2px `--accent` top indicator, no bottom border, and visually continuous with the toolbar row beneath (same background, the strip's bottom border stops under it); inactive `text-fg-muted hover:bg-tab-hover`; close button per tab (keep `aria-label="Close <name>"`). After the last tab an icon button `+` (`aria-label="Open repository"`, tooltip with `mod+o`) when `canPickFolder`. The error `role="alert"` span stays.
- **Layout toggles (item 5).** `LayoutToggles` at the right end of the strip (only when a repo is open): three `IconButton`s with `aria-pressed` and tooltips + shortcuts: "Toggle sidebar" (`PanelLeft`, `mod+b`), "Toggle terminal" (`PanelBottom`, `mod+j`, hidden when `!supportsTerminal`), "Toggle changes panel" (`PanelRight`, `mod+alt+b`). They call `useLayoutStore` `toggle`. Register commands `view.toggleSidebar`, `view.toggleTerminal`, `view.toggleRightPanel` and `view.showGraph` (no default key) in `builtin.ts` with those shortcuts (group "View").
- **RepoView.** Panels rendered conditionally from `useLayoutStore` with stable panel ids so `react-resizable-panels` restores sizes; the bottom panel lives inside the center column (vertical group, default 30%, min 15%). `TerminalPanel` is loaded with `React.lazy` and receives `cwd` = the repo's `path`; it keeps its session when unmounted (UI-TERM contract), so hiding the panel may unmount it. Keep `OperationBanner`, `StashDialog`, `OperationsHost` mounts.
- **CenterArea (item 13).** Switch on `useCenterView(repoId)`: `graph` -> `GraphView`; `commitDiff` -> `CenterHeader` + `FileDiffView`; `worktreeDiff` -> `CenterHeader` + lazy `DiffViewer` (Suspense + `Spinner`) keyed by side and path; if the file left that side (`effectiveOpen` with the current `useStatus`), switch to the other side when present, else `showGraph`; `issues` / `issue` / `newIssue` -> `CenterHeader` + `ForgeMainView`. `GraphView` stays mounted but hidden (`hidden` attribute) while another view shows, so scroll position and selection survive; its `onOpenDetails` shows the right panel (`setVisible("right", true)`) and focuses `#commit-details`.
- **CenterHeader.** 36px, `bg-panel-header`, border-bottom: a back button (`ArrowLeft`, `aria-label="Back"` when the stack has more than one entry, else "Back to graph"; calls `back(repoId)`), then the label: diffs show the path (directory in `text-fg-subtle`, basename in `text-fg`, mono) and a context chip (short oid for commits, `Unstaged`/`Staged` for the working copy); forge views show "Issues", "Issue #N" or "New issue". `Escape` inside the center area (not while typing in an input/textarea, not when a dialog is open) goes back.
- **RightPanel (items 3, 5).** Header with two tabs "Commit" and "Changes" (count badge = staged + unstaged + conflicted) using the design `Tabs` or segmented buttons; `useRightTab` / `setRightTab`. When the selection changes to a commit, switch to Commit; to the WIP row, switch to Changes. When `readOnly`, only Commit exists. Content: `CommitDetailsPanel` or `StagingPanel` (both keep `aria-label` "Commit details" / "Working copy"; only one `id="commit-details"` in the DOM).
- **CommitDetailsPanel.** `Person` rows get an `Avatar` (28px, `useAvatar({ kind: "email", email })`) left of name and email (item 3). Ref chips stay `RefBadge` (lane colors come from UI-GRAPH). Clicking a changed file calls `openCommitDiff(repoId, oid, path)` instead of the inline diff; the file matching the current center view is highlighted (`aria-pressed`). Parent links select the commit and `showGraph`. Blame/file-history buttons unchanged. At the bottom, `<CommitComments repoId oid />`.
- **StagingPanel.** No inline diff: `FileList` gets `open` derived from the center view (`worktreeDiff`) and `onOpen={(f) => openWorktreeDiff(repoId, f.path, f.staged)}`; header and commit box unchanged (keep the `// WIP` title and Stash button).
- **useOpenRepo.** Closing a repo also calls `useWorkspaceStore.getState().forget(id)`.
- **StatusBar.** Restyle with tokens only; keep `data-testid="repo-status"` and `data-testid="app-info"`.

## Tests

`src/app/shell/workbench.test.tsx` (`renderApp()`, `installBackend()`):

- tab strip: active tab `aria-selected`, `+` opens the folder picker (mocked), close button works;
- toggles hide/show sidebar, bottom panel (TerminalPanel stub appears), right panel; state persists in localStorage; `mod+b`, `mod+j`, `mod+alt+b` work; terminal toggle absent with `supportsTerminal: false`;
- right panel auto-switches Commit <-> Changes with selection; readOnly shows only Commit;
- clicking a commit's changed file opens `file-diff` in the center with the header; Escape and the back button return to the graph; the graph grid remains in the DOM while hidden;
- clicking a working-copy file opens the DiffViewer in the center with its stage buttons; staging the whole file switches the view to the staged side;
- `forge-main-view` stub renders for `openIssues`, with header "Issues";
- commit details show an avatar image when `avatarsGet` returns a data URL and initials otherwise.
  Adapt `staging.test.tsx` and `App.test.tsx` to the diff-in-center flow (same user-visible checks, new location).

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm vite build
```

## Acceptance criteria

- Tests green; full suite green; e2e invariants of COMMON hold (`Working copy` visible after clicking `// WIP` with default layout, `Commit details`, `app-info`).
- The graph never remounts when switching center views (assert the same grid element).
- No raw colors; every icon button labelled; focus returns sensibly after Back (to the graph grid).

## Commits

`feat(shell): browser-style repository tabs linked to the toolbar`, `feat(shell): toggle sidebar, terminal and changes panels`, `feat(shell): show diffs and issues in the center with a way back`, `feat(shell): commit and changes tabs in the right panel`, `test(shell): adapt full-app tests to the workbench`.

## Out of scope / needs orchestrator

Toolbar buttons (UI-TOOLBAR), sidebar content (UI-SIDEBAR), terminal internals (UI-TERM), forge views (UI-FORGE), highlighted commit diffs, per-repo layout.
