# UI-TOOLBAR: Undo/Redo, Branch and Stash in the toolbar

- Wave: 1
- Agent: `frontend-agent`, model **haiku**
- Branch/worktree: `feat/toolbar-m9`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.1 marks 2 and "branch"/"stash"; code: `src/features/remotes/{RemoteToolbar,RemotesHost}.tsx`, `src/features/remotes/actions.ts`, `src/stores/remotes.ts`, `src/stores/dnd.ts` (`setPrompt`), `src/stores/repo.ts` (`setStashDialog`), `src/app/commands/registry.ts`; merged contracts: `src/ipc/queries.ts` (`useOplogState`, `useRedo`, `useStatus`, `useRefs`), `src/stores/{layout,workspace}.ts`, `src/app/platform.ts`.
- Frontend only.

## Goal

The toolbar row reads: `[Undo | ▾]  [Fetch]  [Pull | ▾]  [Push | ▾]  [Branch]  [Stash]`. Undo/Redo use the oplog with a preview, Branch creates a branch at HEAD, Stash opens the stash dialog. Read-only platforms keep only Fetch and a fast-forward Pull.

## Owned files

`src/features/remotes/{RemoteToolbar.tsx,RemotesHost.tsx}`, `src/stores/remotes.ts`; primary owner of `src/features/remotes/remotes.test.tsx`; new `src/features/remotes/toolbar.test.tsx`.
Must NOT touch: other files in `src/features/remotes/` (`RemotesSection.tsx` is UI-SIDEBAR's; `actions.ts` is read-only), anything outside `src/features/remotes` and `src/stores/remotes.ts`.

## Behavior

- Row styling: `bg-toolbar`, height 40px, no top border (it continues the active tab), bottom `border-border`. Keep `role="toolbar"` and its label.
- **Undo split button** (leftmost): `Button` "Undo" (`Undo2` icon) runs the existing `history.undo` flow (preview dialog); disabled when `!useOplogState(repoId).data?.canUndo`; tooltip `Undo: <undoDescription>` with `mod+z`. Chevron `IconButton` `aria-label="Undo options"` opens a menu with one item "Redo" (`Redo2` icon, label `Redo: <redoDescription>` when known, shortcut `mod+shift+z`, disabled when `!canRedo`).
- **Redo command** `history.redo` (`mod+shift+z`, group History): dry-run `redo`, show the same preview dialog in redo mode (title "Redo last undone operation?", confirm button "Redo"), apply, toast, `invalidateEverything`. Generalize the undo dialog state in `stores/remotes.ts` to `oplogPreview: { repoId, preview, mode: "undo" | "redo" } | null` (keep `setUndoPreview` working as a wrapper if tests use it). The undo dialog keeps its title "Undo last operation?" and button "Undo" (e2e).
- **Branch** button (`GitBranchPlus`, text "Branch", tooltip "Create branch at HEAD" + `mod+shift+b`): `useDndStore.getState().setPrompt({ kind: "branch", repoId, startPoint: <HEAD oid>, label: <current branch or short oid> })`; disabled while busy or when HEAD is unborn. Register command `branch.create` (`mod+shift+b`).
- **Stash** button (`Archive`, text "Stash", tooltip + `mod+shift+s`): `setStashDialog(repoId, true)`; disabled when the working tree is clean (`useStatus`). Give the existing `stash.save` command the `mod+shift+s` shortcut.
- `staging.commit` (focus commit box): also shows the right panel (`useLayoutStore.getState().setVisible("right", true)`) and selects its Changes tab (`setRightTab(id, "changes")`) before focusing `#commit-summary`.
- **Read-only** (`usePlatform().readOnly`): hide Undo, Push, Branch, Stash and the Pull options chevron; Pull runs with `"ffOnly"`. Commands `history.undo`, `history.redo`, `branch.create`, `stash.save`, `staging.stageAll`, `staging.commit`, `remote.push` get `when` returning false when read-only (read `PlatformInfo` from the query cache `queryKeys.platformInfo`, fallback `fallbackPlatform(navigator.userAgent)`).
- No other toolbar text contains "Push" (e2e selects the Push button by text).

## Tests

`toolbar.test.tsx`: Undo disabled/enabled from `oplogState`, tooltip text uses the description; menu shows Redo disabled/enabled; Redo menu item and `mod+shift+z` open the redo preview and apply `redo(repo, false)`; Branch opens the name prompt with HEAD's oid; Stash disabled on a clean tree and opens the stash dialog otherwise; `mod+shift+b`/`mod+shift+s` work; read-only (Android platform mock) shows only Fetch and Pull and pull uses `ffOnly`; `staging.commit` shows the right panel. `remotes.test.tsx` stays green (adapt only what the new buttons change).

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
```

## Acceptance criteria

- Tests green; full suite green; e2e invariants (Push button text, `Ctrl+Z` -> alertdialog with "Undo") hold.
- Buttons are keyboard reachable, labelled, with tooltips and shortcuts.

## Commits

`feat(toolbar): undo button with a redo menu`, `feat(toolbar): create branch and stash from the toolbar`, `feat(toolbar): hide write actions on read-only platforms`.

## Out of scope / needs orchestrator

Oplog history list UI, redo for AI multi-step plans.
