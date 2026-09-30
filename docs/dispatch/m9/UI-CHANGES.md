# UI-CHANGES: changes list/tree toggle and staged/unstaged separation

- Wave: 1
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/staging-m9-filelist`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.1 items 6, 7; code: `src/features/staging/{FileList.tsx,StagingPanel.tsx,staging.test.tsx}`, `src/design/components/SegmentedControl.tsx`, merged tokens (`--staged-*`, `--unstaged-*`, `--panel-header-bg`).
- Frontend only.

## Goal

In the Changes panel, files can be shown as a flat list or a folder tree, switched by two joined icon buttons at the top of the Unstaged section, and the Conflicted / Unstaged / Staged sections are clearly separated blocks.

## Owned files

`src/features/staging/FileList.tsx`, new `src/features/staging/{FileTree.tsx,fileTree.ts,fileTree.test.ts,fileListMode.ts,filelist.test.tsx}`.
Must NOT touch: `StagingPanel.tsx`, `CommitBox.tsx`, `diff/**`, `mobile/**`, `ops.tsx` (read-only imports are fine), `staging.test.tsx` (UI-SHELL owns it; it must still pass in your worktree without edits).

## Contract kept

`FileList({ repoId, status, open, onOpen })` keeps its props and exports (`FileList`, `OpenFile`, `Section`). In **list mode** (the default) the DOM stays compatible with today's tests and e2e: `role="listbox"` named "Changed files", rows `role="option"` with `id="staging-row-<n>"`, `data-section`, `data-path`, `aria-selected`; `section[aria-label]` per section with `data-testid="section-<id>"`; buttons with exact text `Stage all` and `Unstage all`; keyboard (arrows, Space, Enter, Delete, Ctrl+A, Shift/Ctrl click) and context menus unchanged.

## Behavior

- **Mode toggle.** `fileListMode.ts`: a tiny zustand store persisted in localStorage `gittrunk.fileListMode` (`"list" | "tree"`, default `"list"`). The toggle is a `SegmentedControl`-style pair of icon buttons (`List`, `FolderTree` icons) with `aria-label="Show as list"` / `"Show as tree"`, `aria-pressed`, tooltips; rendered in the Unstaged section header, or in the first visible section header when Unstaged is empty. The mode applies to all sections.
- **Tree mode.** `fileTree.ts` (pure): builds a sorted tree (folders first, then files, case-insensitive) from `FileChange[]`, compacting single-child folder chains (`src/features/staging`), with per-folder file counts. `FileTree.tsx` renders it with `role="tree"` / `role="treeitem"` (`aria-level`, `aria-expanded` on folders, `aria-selected` on files), 12px indentation per level, chevrons; folders start expanded and remember collapse per section and path for the session. Keys: Up/Down move over visible items, Right expands / moves into, Left collapses / moves to parent, Space stages or unstages the focused file or every file under the focused folder, Enter opens a file (`onOpen`), Delete requests discard (unstaged/conflicted). Row hover shows the same `+`/`-` button; folder rows stage/unstage all files below. Conflicted files keep opening the resolver. Multi-select with Ctrl/Shift on file items works like list mode within a section.
- **Separation.** Each section is a block: sticky header (`bg-panel-header`, uppercase title, count as a `Badge`, actions right-aligned), a 2px left rule (`--danger` conflicted, `--unstaged-accent` unstaged, `--staged-accent` staged), staged block background `--staged-bg`, and a `Separator` between blocks. Order stays Conflicted, Unstaged, Staged (staged is adjacent to the commit box below the list). Empty sections are not rendered.

## Tests

`fileTree.test.ts`: tree building, sorting, chain compaction, counts, renamed files placed by new path. `filelist.test.tsx` (render `FileList` directly with `installBackend()` mocks): toggle switches modes and persists across remounts; tree renders folders and files with the ARIA roles; keyboard (Right/Left/Space on a folder stages all files under it with one `stagePaths` call, Enter opens a file); list mode DOM contract above; section blocks carry their `data-testid` and accent classes; toggle appears in the Staged header when Unstaged is empty.

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm vite build
```

## Acceptance criteria

- New tests green; `staging.test.tsx` and all other suites green without edits.
- e2e invariants (`Stage all`, list mode default) hold.
- No raw colors; the toggle and tree are keyboard accessible with visible focus.

## Commits

`feat(staging): show changed files as a list or a folder tree`, `feat(staging): separate conflicted, unstaged and staged sections`.

## Out of scope / needs orchestrator

Moving the diff to the center and the panel header (UI-SHELL owns `StagingPanel.tsx`), mobile Changes screens.
