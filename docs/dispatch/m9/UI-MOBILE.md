# UI-MOBILE: read-only Android, Issues tab, commit comments

- Wave: 1
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/mobile-m9-readonly`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.2 (Mobile read-only, Mobile navigation); code: `src/app/layout/{MobileShell,MoreScreen,NotAvailableScreen}.tsx`, `src/features/repo/mobile/**`, `src/features/operations/actions/{entries.ts,types.ts,useActionContext.ts,ActionMenu.tsx,sheetGroups.tsx}`, `src/features/operations/dnd/OperationsProvider.tsx`, `src/features/remotes/actions.ts` (`pullCurrent`, `fetchRemote`); merged contracts: `src/app/platform.ts` (`readOnly`), `src/stores/nav.ts` (`issues` tab, `issue`/`newIssue` routes), stubs `src/features/forge/{mobile/contrib.ts,CommitComments.tsx}`.
- Frontend only.

## Goal

On read-only platforms (Android, including tablets in regular layout) the app is for checking and following: no git write actions anywhere, fetch and fast-forward pull stay, and the bottom navigation gains an Issues tab. Commit pages show comments.

## Owned files

`src/app/layout/{MobileShell.tsx,MoreScreen.tsx}`, `src/features/repo/mobile/**`, `src/features/operations/actions/{entries.ts,types.ts}`, `src/features/operations/dnd/OperationsProvider.tsx`; primary owner of `src/app/layout/shell.test.tsx` and `src/features/repo/mobile/mobile.test.tsx`; new `src/features/repo/mobile/readonly.test.tsx`.
Must NOT touch: `src/features/forge/**` (UI-FORGE), `src/features/staging/**`, `src/features/remotes/**`, `src/stores/**`, desktop shell files.

## Behavior

- **Navigation.** `NAV_ITEMS` from `usePlatform().readOnly`: read-only -> History, Branches, Issues (`CircleDot` icon), More; otherwise History, Changes, Branches, Issues, More. Register `forgeScreens` in `CONTRIBUTIONS` (and its `useTabBadges` if defined); remove C0's `IssuesPlaceholder`. When read-only and the stored tab is `changes`, show History. When read-only, the routes `compose`, `worktreeDiff`, `conflicts`, `conflict`, `stash` render `NotAvailableScreen`. The WIP row (History) is not shown as actionable when read-only: tapping it does nothing (it cannot appear on a clean clone anyway).
- **Action entries.** `ActionContext.platform` includes `readOnly`; when true, `buildActionEntries` keeps only ids `checkout` (branches, remote branches, tags, commits), `copySha`, `copyName`; everything else (create branch/tag, merge, rebase, cherry-pick, revert, reset, rename, delete, interactive rebase, push entries) is dropped. This filters desktop context menus on tablets and mobile action sheets alike; desktop (`readOnly: false`) output is unchanged (existing tests prove it).
- **Drag and drop.** `OperationsProvider` registers no sensors when read-only (same path as compact).
- **HistoryScreen.** Overflow: Fetch and Pull only; Pull runs `pullCurrent(client, repoId, "ffOnly")` when read-only. Push hidden.
- **BranchesScreen.** Hide "+ new branch", remote add/edit URL/rename/remove; keep Fetch, Copy URL, checkout via the (filtered) action sheet.
- **CommitScreen.** Action sheet uses the filtered entries; add a "Comments" block with `<CommitComments repoId={repoId} oid={oid} />` after the file list. The AI summary button stays.
- **MoreScreen.** When read-only hide Stash, Ask AI and Actions (palette); keep Reflog, Repositories, Settings, About.
- Clone, open, switch and delete repositories stay available everywhere.

## Tests

`readonly.test.tsx` with the Android platform mock at `setViewport(390, 844)`: bottom nav is History/Branches/Issues/More and the Issues tab renders the `forgeScreens.tabs.issues` component (mock the contribution to a marker); `compose` route shows NotAvailable; History overflow has Fetch and Pull only and Pull calls `pull` with `ffOnly`; commit and branch action sheets contain only checkout/copy entries; Branches has no "+" and no remote edit actions; More hides Stash/Ask AI/Actions; no dnd sensors; CommitScreen renders `CommitComments`. Same platform at a regular viewport (tablet): desktop context menu entries filtered. With the desktop platform: nav includes Changes and Issues; entries unchanged (snapshot of ids before/after).
Adapt `shell.test.tsx` / `mobile.test.tsx` only where the tab list changed.

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
```

## Acceptance criteria

- Tests green; full suite green; desktop action menus identical when not read-only.
- No git write action reachable on Android from menus, sheets, palette entry points or drag and drop (CHECK greps call sites of write bindings against `readOnly` gates).

## Commits

`feat(mobile): read-only navigation with an Issues tab`, `feat(mobile): hide git write actions on read-only platforms`, `feat(mobile): show commit comments on the commit page`.

## Out of scope / needs orchestrator

Issue screens themselves (UI-FORGE), backend enforcement of read-only (not planned: UI gating by capability).
