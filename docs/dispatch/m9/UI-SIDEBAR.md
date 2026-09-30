# UI-SIDEBAR: Local section with "+", lane-colored refs, Issues mount

- Wave: 1
- Agent: `frontend-agent`, model **haiku**
- Branch/worktree: `feat/sidebar-m9`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.1 ("+ local", "ISSUES", item 4); code: `src/features/repo/{RefsSidebar,SidebarParts}.tsx`, `src/features/remotes/RemotesSection.tsx`, `src/stores/dnd.ts` (`setPrompt`), `src/features/operations/actions/entries.ts` (how "Create branch here…" builds its prompt); merged contracts: `src/ipc/queries.ts` (`useRefColors`, `useRefs`), `src/lib/laneColor.ts`, `src/stores/workspace.ts` (`showGraph`), stub `src/features/forge/IssuesSection.tsx`, `SidebarParts` props `Section.actions` and `Item.leading` (added by C0).
- Frontend only.

## Goal

The sidebar's first section is `Local` with a `+` that creates a branch at HEAD; branches (local and remote) and tags show a lane-colored icon matching the graph; clicking a ref returns the center to the graph; the Issues section (UI-FORGE) is mounted last.

## Owned files

`src/features/repo/{RefsSidebar.tsx,SidebarParts.tsx}` (styling of `SidebarParts` only, keep its props), `src/features/remotes/RemotesSection.tsx`; new `src/features/repo/sidebar.test.tsx`.
Must NOT touch: `src/features/history-views/**`, other remotes files, `src/features/forge/**`, `src/stores/**`.

## Behavior

- `Section title="Local"` (was "Branches"); `actions` = `IconButton size="xs"` (`Plus`, `aria-label="Create branch"`, tooltip "Create branch at HEAD"), hidden when `usePlatform().readOnly`; it calls `useDndStore.getState().setPrompt({ kind: "branch", repoId, startPoint: <HEAD oid from refs.head>, label: <HEAD branch name or short oid> })`; disabled when HEAD is unborn.
- `leading` icons (14px, `aria-hidden`): local branches `GitBranch`, remote branches `GitBranch` (in `RemotesSection`), tags `Tag`, colored with `style={{ color: laneVar(color) }}` where `color = useRefColors(repoId).get(fullName)` (tags: `refs/tags/<name>`); refs not in the graph use `text-fg-subtle`. The HEAD branch keeps its bold/accent label.
- Clicking a branch, remote branch, tag or stash selects its commit **and** calls `showGraph(repoId)`.
- Mount `<IssuesSection repoId={repoId} />` after the worktrees/submodules sections.
- `SidebarParts` restyle: section headers `text-fg-subtle`, 28px, hover `text-fg-muted`; items keep `h-6`, `hover:bg-surface-hover`; indentation accounts for the leading icon. No prop changes.

## Tests

`sidebar.test.tsx` (`renderApp()` or render `RefsSidebar` with `installBackend()`): the first section is titled "Local"; `+` opens the branch name prompt with HEAD's oid; `+` absent with the Android platform mock; icons colored with `var(--lane-N)` from `graphLoad`'s `refColors` and neutral for unknown refs; clicking a branch while a diff is open in the center returns to the graph (`useCenterView` is graph); the Issues stub is rendered (mock it to render a marker).

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
```

## Acceptance criteria

- Tests green; full suite green (`remotes.test.tsx` belongs to UI-TOOLBAR: adapt only assertions your change breaks, e.g. the "Branches" title, in a separate commit).
- No raw colors; the `+` button is keyboard reachable and labelled.

## Commits

`feat(sidebar): rename Branches to Local and create branches from its header`, `feat(sidebar): color refs with their graph lane`, `feat(sidebar): mount the Issues section`.

## Out of scope / needs orchestrator

Issues section content (UI-FORGE), sidebar drag and drop changes.
