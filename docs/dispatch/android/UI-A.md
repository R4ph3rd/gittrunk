# UI-A: mobile shell, navigation, back handling, repo switcher, settings and More

- Wave: 2 (parallel with R1b-2, C2)
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/mobile-ui-a-shell`
- Read first: `docs/dispatch/android/COMMON.md`, `docs/PLAN.md` §11, `docs/MOBILE_DESIGN.md` §2 (all), §3 "Common frame", §3.1, §3.10, §4 "Android back button", "Soft keyboard", "Safe areas", §7 package A; the merged contracts: `src/app/platform.ts` (R0), `src/app/layout/*` and `src/test/viewport.ts` (S0), `src/design/components/{AppBar,BottomNav,Sheet,ActionSheet,ListRow,ResponsiveDialog}.tsx` and `src/design/hooks` (UI-D).
- Frontend only: no cargo.

## Goal

On compact layouts render a single-pane mobile shell (AppBar per screen, BottomNav/NavRail, drill-down stack) instead of the desktop tree, with Android back semantics, a repo switcher, a More screen, settings as pages, and capability-aware Welcome. Define the navigation contract and the screen registry that UI-B and UI-C fill in Wave 3, and make the shell usable before they land by falling back to the existing desktop components. At regular layout the desktop tree renders exactly as today.

## Owned files

Create:

- `src/stores/nav.ts`
- `src/app/layout/registry.ts`, `src/app/layout/MobileShell.tsx`, `src/app/layout/ShellAppBar.tsx`, `src/app/layout/MoreScreen.tsx`, `src/app/layout/RepoSwitcherSheet.tsx`, `src/app/layout/NotAvailableScreen.tsx`, `src/app/layout/usePlatformEffects.ts` (back-button install, resume refetch), `src/app/layout/shell.test.tsx`
- Stub contribution files that UI-B and UI-C take over in Wave 3 (create them with exactly the content below, nothing more): `src/features/staging/mobile/contrib.ts`, `src/features/repo/mobile/contrib.ts`

Modify: `src/app/App.tsx` (branch at the top: `isCompact ? <MobileShell/> : <existing tree>`; the existing JSX is moved into a `DesktopShell` function unchanged), `src/app/testing.tsx` (add `renderAppAt(width, height)` helper only), `src/app/commands/**` (only if palette entries need compact awareness), `src/features/repo/{Welcome,RepoTabs,StatusBar,useOpenRepo}.tsx` (compact / capability branches only), `src/features/settings/**` (settings pages on compact, capability-gated fields), `src/features/ops/**` (expose progress for the AppBar line; an expandable op sheet).

Must NOT touch: `src/design/**`, `src/index.css`, `index.html`, `src/ipc/**`, `src/app/platform.ts`, `src/app/layout/{queries,useLayout,LayoutProvider,back,useBackHandler}.*` (S0; import only), `src/features/{staging,graph,operations,remotes,history-views,stash,ai}/**` except the two stub files, `src/features/repo/{CommitDetailsPanel,RefsSidebar,SidebarParts,RepoView,FileDiffView}.tsx` (UI-C).

## Contract you define (UI-B and UI-C code against it; keep exact)

```ts
// src/stores/nav.ts
export type TabId = "history" | "changes" | "branches" | "more";
export type Route =
  | { name: "commit"; oid: string } // UI-C
  | { name: "commitFile"; oid: string; path: string } // UI-C
  | { name: "fileHistory"; path: string } // UI-C
  | { name: "reflog"; ref: string | null } // UI-C
  | { name: "worktreeDiff"; path: string; staged: boolean } // UI-B
  | { name: "compose" } // UI-B
  | { name: "conflicts" } // UI-B
  | { name: "conflict"; path: string } // UI-B
  | { name: "stash" } // UI-B
  | { name: "settings"; section?: "general" | "git" | "ai" }; // UI-A
export type RouteName = Route["name"];
export interface RepoNav {
  tab: TabId;
  stack: Route[];
}
export const NO_REPO = "__none__";
interface NavState {
  byRepo: Record<string, RepoNav>;
  setTab(repoId: string, tab: TabId): void; // switching tab clears the stack
  push(repoId: string, route: Route): void;
  pop(repoId: string): boolean; // false when the stack was empty
  replace(repoId: string, route: Route): void;
  resetTab(repoId: string): void; // clear the stack
  forget(repoId: string): void; // on repo close
}
export const useNavStore: UseBoundStore<StoreApi<NavState>>;
export function useNav(): {
  repoId: string; // active repo id or NO_REPO
  tab: TabId;
  stack: Route[];
  top: Route | null;
  push(route: Route): void;
  pop(): boolean;
  replace(route: Route): void;
  setTab(tab: TabId): void;
  resetTab(): void;
};

// src/app/layout/registry.ts
import type { ComponentType } from "react";
export interface TabScreenProps {
  repoId: string;
}
export type RouteScreenProps<N extends RouteName> = {
  repoId: string;
  route: Extract<Route, { name: N }>;
};
export type RouteScreens = { [N in RouteName]?: ComponentType<RouteScreenProps<N>> };
export interface ScreenContribution {
  tabs?: Partial<Record<TabId, ComponentType<TabScreenProps>>>;
  routes?: RouteScreens;
  /** Hook returning tab badges (e.g. Changes count). Called unconditionally on every render of
   *  MobileShell; contributions are static modules, so hook order is stable. */
  useTabBadges?: (repoId: string) => Partial<Record<TabId, number | boolean>>;
}

// src/app/layout/ShellAppBar.tsx: every mobile screen renders this at its top
export interface ShellAppBarProps {
  repoId: string | null;
  title?: ReactNode; // default: repo switcher button (repo name + current branch subtitle)
  subtitle?: ReactNode;
  back?: boolean; // shows Back, which calls useNav().pop()
  actions?: ReactNode;
  children?: ReactNode; // rendered under the bar (search fields)
}
export function ShellAppBar(props: ShellAppBarProps): JSX.Element;
// Wires: safe-top, op progress line from the ops store, repo switcher sheet, and renders
// <OperationBanner repoId/> (UI-B owns its compact look) right under the bar.
```

Stub files (Wave 3 packages replace the body, keep the export name):

```ts
// src/features/staging/mobile/contrib.ts   (owned by UI-B in Wave 3)
import type { ScreenContribution } from "@/app/layout/registry";
export const stagingScreens: ScreenContribution = {};

// src/features/repo/mobile/contrib.ts      (owned by UI-C in Wave 3)
import type { ScreenContribution } from "@/app/layout/registry";
export const repoScreens: ScreenContribution = {};
```

`MobileShell` merges `[repoScreens, stagingScreens, shellScreens]` (shell provides `tabs.more` and `routes.settings`). Fallbacks while a contribution is missing: History tab => existing `GraphView` (selecting a commit pushes `commit`), Changes => existing `StagingPanel`, Branches => existing `RefsSidebar`, any missing route => `NotAvailableScreen` with Back. The shell must mount the same hosts the desktop tree mounts (`useRepoEvents`, `OperationsHost`, `StashDialog`, `CommandHost`, `RemotesHost`, `SettingsHost`, `AiHost`, `ConflictSuggestProvider`, `OperationsProvider`) so every existing dialog keeps working on compact.

## Behavior to implement

- `App.tsx`: `useLayout().isCompact` picks `MobileShell` or `DesktopShell` (today's JSX, unchanged). No `hidden`-class branching.
- Zero repos on compact: full-screen `Welcome` (compact variant) with no BottomNav.
- BottomNav (portrait) / NavRail (`isShort`) with History, Changes (badge dot from status count), Branches, More; re-tapping the active tab pops to root, then scrolls the root to top. BottomNav hides while a text input is focused (`focusin`/`focusout`).
- Back (`usePlatformEffects`, active when `usePlatform().mobile`): call `installBackButton()` once; register one base handler with `pushBackHandler` implementing, in order: pop the stack; else if tab != history go to History; else first press shows toast "Press back again to exit" and returns true, a second press within 2s calls `commands.appExit()` (R0) and returns true. Overlays (Sheets) already register above it (UI-D). On desktop nothing is installed.
- Resume: when `usePlatform().mobile`, on `visibilitychange` to visible invalidate the active repo's status and refs queries once (throttle 2s).
- `RepoSwitcherSheet`: open repos (radio semantics, switch `activeId`, close button per row), "Open folder" only when `canPickFolder`, "Clone repository" (existing clone dialog action), recent repos. Recent rows whose path is inside `defaultReposDir` get a Delete action (ActionSheet + confirm) calling `commands.repoDelete` then refreshing recent repos.
- `Welcome` (compact branch only, desktop unchanged): hide "Open folder" when `!canPickFolder` (on any layout, since an Android tablet is regular), clone button, recent list with the same delete action; paths shown truncated in the middle.
- `MoreScreen`: rows for Stash (push `stash`), Reflog (push `reflog` with `ref: null`), Ask AI (existing AI action), Actions (command palette), Settings (push `settings`), Repositories (switcher), About (`app_info` version, git/libgit2 version, platform).
- Settings on compact: route `settings` renders a section list (General, Git, AI) and section pages reusing the existing section components from `SettingsDialog`; `KeyboardSection` not rendered on compact. On any layout: hide the git binary path field when `!hasGitCli`; show a "Git identity" (name, email) form using `useGitIdentity`/`useSetGitIdentity` when `!hasGitCli` (desktop unchanged); disable the pull strategy "rebase" option (with a short hint) when `!supportsRebase`.
- `StatusBar` and `RepoTabs` are not rendered on compact (the shell replaces them); their desktop output is unchanged.

## Tests (`src/app/layout/shell.test.tsx`, with `installBackend()` and `setViewport`)

- 390x844: BottomNav with 4 tabs; no `RefsSidebar` resizable group; History fallback renders; switching tabs works; re-tap pops to root; `nav.push({name:"settings"})` shows a page with Back; back order with a simulated `popstate` and `platformInfo` mocked as Android: open Sheet closes first, then pop, then tab => History, then toast, then second press calls `appExit`.
- 844x390: NavRail instead of BottomNav.
- 1400x900 and default jsdom (no matchMedia): the existing desktop tree renders; `App.test.tsx` and `commands.test.tsx` pass untouched.
- Repo switcher lists open repos and switches `activeId`; delete action only for paths under `defaultReposDir` and calls `repoDelete`.
- Capability gating: with Android platform mocked, Welcome has no "Open folder" and Settings shows the identity form and hides the git path field; with desktop mocks, both unchanged.

## Commits

`feat(mobile): add navigation store and screen registry`, `feat(mobile): add mobile shell with bottom navigation and back handling`, `feat(mobile): add repo switcher, More screen and settings pages`, `feat(mobile): gate folder picking and git path on platform capabilities`.

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm vite build
```

## Acceptance criteria

- All tests above pass; the full existing suite passes unchanged.
- Contract types exported exactly as specified; stub contribution files contain only the stub.
- Desktop tree unchanged at regular layout (`git diff src/app/App.tsx` shows the existing JSX moved verbatim into `DesktopShell`).
- No new dependencies; no edits outside owned paths.

## Out of scope / needs orchestrator

Screens for History/Branches/Commit (UI-C) and Changes/Diff/Compose/Conflicts/Stash (UI-B). Capability changes in `capabilities/*.json` are not needed (the back button uses the history sentinel and `app_exit`).
