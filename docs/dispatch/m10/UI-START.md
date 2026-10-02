# UI-START: tab strip, new-tab start view, Home page, workspaces

- Wave: 1 (after C10 is merged; parallel with B10, UI-PULLS, UI-BACKDROP, UI-TOPRIGHT; merged last of Wave 1)
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/shell-m10-start`
- Read first: `docs/PLAN.md` §13 (items 1, 2, 5 and "Workspace", "Known repositories", "Tab model"); then the files below.
- Frontend only: never run cargo, `pnpm bindings` or `pnpm tauri`.

## Goal

1. Clicking `+` in the tab strip opens a **New tab** (not the folder picker) showing the start view: Open existing repository, Clone, Create repository (init), and up to 10 recent repositories.
2. Clicking the `gittrunk` wordmark opens a **Home** page: action buttons (Open folder, Clone, Create repository, New workspace, Integrations), workspaces, Recent (10), All repositories (known list), over the `MeshBackdrop` page gradient.
3. The right end of the tab strip shows `[layout toggles] | [Notifications][Settings]` with visible spacing between the two groups.

## Rules (every M10 brief)

- Repo `/home/user/gittrunk`, integration branch `claude/relaxed-allen-0mjwae`. Worktree: `git -C /home/user/gittrunk worktree add /home/user/wt-shell-m10-start -b feat/shell-m10-start claude/relaxed-allen-0mjwae`; work only there with absolute paths; `pnpm install --frozen-lockfile` once.
- Touch only "Owned files". Need a hook, type, store field, token or dependency? Do not edit it: list it under "Needs orchestrator" and work around locally (a private helper in your files).
- Styling: tokens only (`bg-surface`, `text-fg-muted`, `border-border`, `bg-tabbar`, `var(--token)`); no hex/rgb, no Tailwind palette classes. lucide-react icons; icon-only buttons have `aria-label` + `Tooltip` (with the shortcut when there is one); everything keyboard reachable with the focus ring.
- Capabilities from `usePlatform()` (`canPickFolder`, `readOnly`), layout from `useLayout()`; never infer one from the other.
- Tests: Vitest + Testing Library, `vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock())`, `vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock())`, `installBackend()`, `installDomShims()`, `resetStore()`, `renderApp()` from `src/app/testing.tsx`; mock `@tauri-apps/plugin-dialog` where the picker is involved. The whole suite must pass. If your change breaks an assertion in a test file you do not own, adapt only that assertion in a separate commit `test(<scope>): adapt <file> to <change>` and list it.
- e2e invariants (must keep working): at startup with no repository open, the start view contains exactly one `section[aria-label="Recent repositories"]` whose buttons contain the repository names; graph `aria-label="Commit graph"` with `role="row"`; `data-testid="app-info"` in the status bar; exactly one visible button without `aria-label` whose text contains `Push`; `Ctrl+Z` opens an `alertdialog` with an `Undo` button.
- Commits: Conventional Commits with a scope, made with
  `git -c user.name=Claude -c user.email=noreply@anthropic.com commit --author="R4ph3rd <43202876+R4ph3rd@users.noreply.github.com>" -F - <<'EOF' ... EOF`; every message ends with a blank line and exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FzHMmoKCskK5U6Gdp6AZmv
  ```
  Do not push, rebase or merge.
- Report back: branch and hashes; every gate with exit code; acceptance one line each; deviations; "Needs orchestrator"; foreign tests adapted (file, assertion, reason); anything visual you could not verify.

## Owned files

Modify: `src/app/App.tsx`, `src/features/repo/RepoTabs.tsx`, `src/features/repo/Welcome.tsx`, `src/features/repo/useOpenRepo.ts`, `src/app/commands/builtin.ts`, `src/app/commands/CommandHost.tsx`, `src/app/App.test.tsx` and `src/app/commands.test.tsx` (primary owner in M10).
Create: `src/features/home/{HomePage.tsx,HomeHost.tsx,InitRepoDialog.tsx,WorkspaceDialog.tsx,RepoLists.tsx,store.ts,home.test.tsx}`, `src/features/repo/tabs.test.tsx`.
Must NOT touch: `src/stores/**`, `src/ipc/**`, `src/design/**`, `src/app/shell/**` (you may import `LayoutToggles`), `src/features/{forge,settings,notifications,graph}/**`, `src/features/repo/{RefsSidebar,RecentRepos}.tsx`.

## Contracts you use (merged by C10; read the real files)

- `useRepoStore` (`src/stores/repo.ts`): `repos`, `activeId`, `page: ShellPage` (`{kind:"repo"} | {kind:"home"} | {kind:"newTab"; id}`), `newTabs: string[]`, `openNewTab(): string`, `closeNewTab(id)`, `showHome()`, `showRepoPage()`, `addRepo(info)` (also shows the repo page and removes the shown placeholder), `setActive(id)` (also shows the repo page), `removeRepo`.
- `src/ipc/queries.ts`: `useRecentRepos()`, `useKnownRepos()` (`KnownRepo { path, name, lastOpened, exists }`), `useForgetRepo()` (mutation, arg = path), `invalidateRepoLists(client)`, `queryKeys`.
- `commands.repoInit({ path, bare: false, initialBranch })` → `RepoInfo` (creates the folder; backend exists already).
- Settings: `useSettings()` (`backdrop: boolean`, `workspaces: Workspace[] { id, name, repos: string[] }`), `updateSettings(patch)` → `{ ok } | { ok: false, message }`, `openSettings(section?)` (`src/stores/settings.ts`).
- `useOpenRepo()` → `{ openPath(path), pickAndOpen() }`, `useCloseRepo()` (`src/features/repo/useOpenRepo.ts`).
- `useRemotesUi.getState().setCloneOpen(true)` (`src/stores/remotes.ts`) opens the existing clone dialog (mounted by `RemotesHost`).
- `RecentRepoRows` (`src/features/repo/RecentRepos.tsx`), `truncateMiddle` (`src/features/repo/recentPaths.ts`), `joinPath` (`src/features/remotes/validate.ts`), `relativeDate` (`src/features/graph/format.ts`).
- Design: `Button` (variants `primary`, `secondary` are opaque), `IconButton` (sizes `xs|sm|md`), `Tooltip`, `Input`, `Label`, `Checkbox`, `Badge`, `Separator`, `Dialog*`, `AlertDialog*`, `DropdownMenu*`, `EmptyState`, `toast`, `MeshBackdrop` (`{ intensity: "subtle" | "page"; scrollRef?; scrollKey?; className? }`, place as first child of a `relative isolate` container; UI-BACKDROP implements it, a plain div until then) from `@/design/components`.
- `NotificationsButton` (`src/features/notifications/NotificationsButton.tsx`, no props; UI-TOPRIGHT implements it, renders `null` until then).
- `formatShortcut` (`src/app/shortcuts`), `useRegisterCommands` / `Command` (`src/app/commands`).

## Behavior

### Tab strip (`RepoTabs.tsx`)

- Wordmark: a `button` (`aria-label="Home"`, `aria-current="page"` when `page.kind === "home"`, `Tooltip` "Home") wrapping the existing icon + "gittrunk" text, `rounded-md px-1.5 hover:bg-tab-hover`; click → `showHome()`.
- Repository tabs: active only when `r.id === activeId && page.kind === "repo"`.
- After the repository tabs, one tab per `newTabs` id: label "New tab" (role `tab`, `aria-selected` when shown), close button `aria-label="Close New tab"` → `closeNewTab(id)`; same visual style as repository tabs (active one with the accent top indicator).
- `+` (`IconButton size="sm" aria-label="New tab"`, Tooltip "New tab" with `mod+t`), always shown (also when `canPickFolder` is false) → `openNewTab()`. It never opens the folder picker.
- Right cluster (`ml-auto flex h-full items-center gap-3`): `LayoutToggles` only when `activeId && page.kind === "repo"`; then, if the toggles are shown, `<Separator orientation="vertical" decorative={false} className="h-4" />` (non-decorative so it is exposed as `role="separator"`); then `div role="group" aria-label="Application"` with `<NotificationsButton />` and a Settings `IconButton size="sm"` (`aria-label="Settings"`, lucide `Settings`, Tooltip "Settings" with `formatShortcut("mod+,")`, click → `openSettings()`). The 12px gap plus the divider is the visible separation.

### Desktop shell (`App.tsx`)

- `page = useRepoStore(s => s.page)`. Keep the active `RepoView` (and its providers) **mounted** inside a wrapper with `hidden={page.kind !== "repo"}` so graph scroll, selection and terminal survive; render `<HomePage />` when `page.kind === "home"`, else `<Welcome />` when `page.kind === "newTab"` or there is no active repository.
- Mount `<HomeHost />` (init and workspace dialogs) once next to `RemotesHost`.
- `CommandHost.tsx`: the command context's `repoId` is `activeId` only when `page.kind === "repo"`, else `null` (repo commands do not act on a hidden repository).

### Commands (`builtin.ts`)

- `app.newTab` "New tab", `mod+t`, group "Repository", icon `Plus` → `openNewTab()`.
- `app.home` "Go to Home", group "View", icon `House` → `showHome()` (no shortcut).
- `repo.close` (`mod+w`): when a new tab is shown, close that placeholder; otherwise unchanged. Its `when` allows both cases.
- `repo.open` (`mod+o`) keeps opening the folder picker directly.

### Start view (`Welcome.tsx`, desktop branch; the compact branch only gets the 10-item cap)

- Buttons: "Open repository" (`pickAndOpen`, only when `canPickFolder`), "Clone repository" (existing), "Create repository" (opens `InitRepoDialog`; only when `canPickFolder && !readOnly`).
- Recent list capped at 10 (`slice(0, 10)`), same `section aria-label="Recent repositories"` and button rows (e2e).
- Opening any repository from a new tab replaces the placeholder (store already does it).

### Init dialog (`InitRepoDialog.tsx`)

Fields: "Location" (parent folder `Input` + "Browse…" with `open({ directory: true })` from `@tauri-apps/plugin-dialog`), "Name" (folder name, required, no `/`, `\`, `..`), "Initial branch" (default `main`, required, no spaces, not starting with `-`, no `..`). The full path shown below (`joinPath(parent, name)`). Submit → `commands.repoInit({ path, bare: false, initialBranch })` via `unwrap`, then `useRepoStore.getState().addRepo(info)`, `invalidateRepoLists(client)`, `toast.success("Created <name>")`, close. Errors inline (`role="alert"`), the dialog stays open.

### Home (`HomePage.tsx`, `RepoLists.tsx`)

- Layout: outer `relative isolate flex min-h-0 flex-1 bg-bg`; `{settings.backdrop && <MeshBackdrop intensity="page" />}`; scrolling content above it (`relative overflow-y-auto`, centered column `max-w-3xl`, `p-8`, `gap-6`).
- Contrast rule (WCAG): text placed directly on the gradient uses only `text-fg` or `text-fg-muted` (the backdrop tokens guarantee ≥ 4.5:1 for those); everything else (lists, `text-fg-subtle`, accent text, badges) sits on opaque cards: `rounded-lg border border-border bg-surface`.
- Header: `h1` "Home" (or "gittrunk") in `text-fg`, one line of `text-fg-muted` help.
- Action row (buttons, opaque `secondary`, first one `primary`): Open folder (`FolderOpen`, `pickAndOpen`, only `canPickFolder`), Clone (`CopyPlus`), Create repository (`FolderPlus`, only `canPickFolder && !readOnly`), New workspace (`LayoutGrid`), Integrations (`Plug`, `openSettings("integrations")`).
- Workspaces (only when `workspaces.length > 0`): `section aria-label="Workspaces"`, one card per workspace: name, "N repositories", "Open all" (opens every path in order with `openPath`; paths missing from the known list or failing are reported in one `toast.error` listing them), and a `DropdownMenu` (`aria-label="Actions for <name>"`) with Edit and Delete (Delete asks with an `AlertDialog`, then `updateSettings({ workspaces: without })`).
- Recent: `section aria-label="Recently opened"` (not "Recent repositories", to keep the e2e selector unique), up to 10 rows: name, `truncateMiddle(path)` in mono, `relativeDate(lastOpened)`; click → `openPath`.
- All repositories: `section aria-label="All repositories"` from `useKnownRepos()`; a filter `Input` (`aria-label="Filter repositories"`) when there are more than 10; rows like Recent; `exists === false` rows show a `Badge` "Missing" and cannot be opened; each row has a `DropdownMenu` (`aria-label="Actions for <name>"`) with "Remove from list" → `useForgetRepo().mutate(path)`. Empty state when the list is empty.

### Workspaces (`WorkspaceDialog.tsx`, `store.ts`)

- `store.ts`: `useHomeDialogs` zustand store `{ init: boolean; workspace: { mode: "create" } | { mode: "edit"; id: string } | null; openInit(); openWorkspace(w); close() }`. `HomeHost` renders both dialogs bound to it; the start view and Home call `openInit()` / `openWorkspace(...)`.
- Dialog: "Name" `Input` (required, ≤ 64 chars), a checklist (`Checkbox` per known repository that exists, label = name, description = path), "Add folder…" (directory picker; adds the path to the selection even if unknown), Save → `updateSettings({ workspaces: next })` with `id = crypto.randomUUID()` on create; the backend validates, so show `result.message` inline on failure and keep the dialog open.

## Tests

`src/features/repo/tabs.test.tsx`:

- `+` adds a "New tab" tab and shows Open / Clone / Create repository plus the recent rows; the dialog plugin `open` is **not** called.
- Choosing a recent repository from the new tab opens it and the placeholder disappears; closing a placeholder with its X works; `mod+t` opens a new tab; `mod+w` closes a shown placeholder.
- The wordmark shows Home and sets `aria-current`; clicking a repository tab returns to it and the graph is still mounted (no remount: `graphLoad` not called again).
- Right cluster: Settings button opens the settings dialog; layout toggles hidden on Home and on a new tab, visible on a repository; a `role="separator"` sits between the groups when the toggles are visible.

`src/features/home/home.test.tsx`:

- Home lists recent (≤ 10) and known repositories; a missing one shows "Missing" and is not clickable; "Remove from list" calls `repoForget` with its path and the list refetches.
- Init dialog calls `repoInit({ path: "/parent/name", bare: false, initialBranch: "main" })`, adds the tab and toasts; a backend error stays inline.
- Creating a workspace calls `settingsSet` with the new workspace (name, selected paths); "Open all" calls `repoOpen` once per path; Delete asks for confirmation.
- `MeshBackdrop` (`data-testid="mesh-backdrop"`) is rendered when `backdrop` is true and absent when false.
- Android platform mock (`ANDROID_PLATFORM` from `src/app/platform.ts`): no Open folder and no Create repository buttons.

## Prove it

```bash
cd /home/user/wt-shell-m10-start && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm build
```

## Acceptance criteria

- Tests above pass; whole suite green; lint/format/typecheck/build exit 0.
- `+` never opens the folder picker; the startup view with no repository still satisfies the e2e `Recent repositories` selector.
- The open repository stays mounted while Home or a new tab is shown.
- No raw colors; every new control is labelled and keyboard reachable.

## Commits

`feat(shell): open new tabs on a start page`, `feat(shell): home page with recent and known repositories`, `feat(shell): create repositories from the start page`, `feat(shell): workspaces on the home page`, `feat(shell): notifications and settings buttons in the tab strip`.

## Conflicts

- `src/app/shell/workbench.test.tsx` (UI-PULLS primary) and `src/features/settings/settings.test.tsx` (UI-TOPRIGHT primary) mention the old "Open repository" `+` button: adapt only those assertions in a separate `test(shell)` commit. `src/app/commands.test.tsx` is yours.
- `NotificationsButton` and `MeshBackdrop` are filled in parallel by UI-TOPRIGHT and UI-BACKDROP: only use their props; do not test their inner content.

## Out of scope / needs orchestrator

Home and new tabs on compact layouts, per-workspace layouts, reveal in file manager, reordering tabs.
