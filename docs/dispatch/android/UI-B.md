# UI-B: Changes, diff, commit composer, conflicts, stash and AI dialogs on mobile

- Wave: 3 (parallel with UI-C)
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/mobile-ui-b-changes`
- Read first: `docs/dispatch/android/COMMON.md`, `docs/PLAN.md` §11, `docs/MOBILE_DESIGN.md` §2 v1 scope table, §3.4, §3.5, §3.7, §3.8, §3.9, §4 (touch, sheets, swipe, pull-to-refresh, soft keyboard), §6, §7 package B; merged contracts: `src/stores/nav.ts`, `src/app/layout/{registry.ts,ShellAppBar.tsx}` (UI-A), `src/design/components` + `src/design/hooks` (UI-D), `src/app/layout/useLayout.ts`, `src/test/viewport.ts` (S0), `src/app/platform.ts` and `src/ipc/queries.ts` identity hooks (R0).
- Frontend only: no cargo.

## Goal

On compact layouts, the Changes tab and its drill-downs work by touch: a two-section file list with checkboxes and swipe actions, a unified diff page with hunk staging, a commit composer that survives the soft keyboard, reduced conflict resolution, a stash page, AI dialogs as sheets, and a first-commit git identity prompt on devices without a git CLI. Desktop rendering and behavior are unchanged.

## Owned files

- `src/features/staging/**` including new `src/features/staging/mobile/{ChangesScreen,FileRow,DiffScreen,ComposerScreen,ComposerBar,IdentitySheet}.tsx`, `src/features/staging/mobile/mobile.test.tsx`, and `src/features/staging/mobile/contrib.ts` (stub created by UI-A; you replace its body, keep `export const stagingScreens: ScreenContribution`)
- `src/features/staging/diff/**` (compact: forced unified, hunk buttons)
- `src/features/operations/conflicts/**` including new `mobile/{ConflictsScreen,ConflictFileScreen}.tsx` and `mobile/conflicts.mobile.test.tsx`
- `src/features/operations/sequencer/**` (compact `OperationBanner`)
- `src/features/stash/**` including new `StashScreen.tsx`
- `src/features/ai/**` (dialogs switched to `ResponsiveDialog`)
- `src/stores/ai.ts`, new `src/stores/composer.ts` (draft persistence)

Must NOT touch: `src/features/{graph,repo,remotes,history-views}/**`, `src/features/operations/{actions,dnd,preview,rebase}/**`, `src/features/operations/{OperationsHost.tsx,queries.ts,testing.ts,operations.test.tsx}` (UI-C), `src/app/**`, `src/stores/nav.ts`, `src/design/**`, `src/ipc/**`, `src/index.css`. Existing tests (`staging.test.tsx`, `ai.test.tsx`, `operations.test.tsx`) must pass without edits.

## Contract with the shell

`stagingScreens` provides:

```ts
tabs:   { changes: ChangesScreen }
routes: { worktreeDiff: DiffScreen, compose: ComposerScreen, conflicts: ConflictsScreen,
          conflict: ConflictFileScreen, stash: StashScreen }
```

Every screen renders `<ShellAppBar repoId=... back? title actions/>` at its top (tab roots without `back`). Navigate with `useNav()` (`push`, `pop`, `setTab`). UI-C pushes `{ name: "worktreeDiff" }` never; UI-C's WIP row calls `setTab("changes")`.

`DiffViewer` on compact must force unified mode and hide line selection automatically (no new prop needed by callers), because UI-C's commit file page reuses it.

## Behavior (MOBILE_DESIGN references)

- ChangesScreen (§3.4): sections STAGED / UNSTAGED with "Unstage all" / "Stage all"; rows via `ListRow` inside `SwipeRow` (swipe right = stage on unstaged rows, swipe left = unstage on staged rows, swipe left = discard with confirm on unstaged rows); 44px checkbox toggles stage; tap pushes `worktreeDiff`; tree mode hidden; `PullToRefresh` refetches status; sticky `ComposerBar` (1-line summary + Commit button showing staged count; tapping the field pushes `compose`); AppBar action: Stash (opens the existing stash save flow as a sheet).
- DiffScreen (§3.4): filename (truncate start), prev/next file, `DiffViewer` unified, per-hunk "Stage hunk"/"Unstage hunk" 44px buttons calling the same hunk staging bindings the desktop uses; long-press on a hunk header opens an `ActionSheet` (stage, discard with confirm); "Load full diff" gate above 2000 lines; the page follows the file across stage/unstage (reuse `StagingPanel`'s effective-open logic).
- ComposerScreen (§3.5): AppBar close + primary Commit (disabled until valid; `message.ts` unchanged), summary with 72-char counter, description textarea, Amend and Sign-off switches (amend pre-fills the last message as today), staged-file count row, AI message button when AI is enabled; draft in `src/stores/composer.ts` per repo, survives back; keyboard handling via `useKeyboardInset`, `enterkeyhint`, `autocapitalize="sentences"`.
- IdentitySheet: before the first commit on a device where `usePlatform().hasGitCli` is false, if `useGitIdentity()` lacks name or email, open a sheet asking for both (`autocapitalize="none"` for email) and save via `useSetGitIdentity()`, then continue the commit. Never shown on desktop.
- Conflicts (§3.8): ConflictsScreen lists files with resolved state and Abort / Continue (Continue enabled only when all resolved); ConflictFileScreen shows each conflict hunk as ours/theirs cards with "Use ours", "Use theirs", "Both" per hunk (use `markers.ts`), "Suggest with AI" when available, and "Edit manually" opening the existing `ConflictEditor` full screen (lazy). Resolution uses the same `conflict_resolve` path as desktop.
- `OperationBanner` compact variant: sticky bar under the AppBar with state text, "Resolve" (push `conflicts`) and an overflow `ActionSheet` with Continue / Skip / Abort.
- StashScreen (§3.7): list of stashes; tap => `ActionSheet` (Apply, Pop, Drop with confirm, View as commit if cheap); "Stash changes" sheet (message, include untracked) reusing `StashDialog` logic.
- AI (§3.9): `AskAiDialog`, `AiPrDescriptionDialog`, `AiSettingsDialog`, payload preview and plan view render through `ResponsiveDialog`; payload preview collapsible above a sticky Send button on compact.

## Tests

`src/features/staging/mobile/mobile.test.tsx` and `src/features/operations/conflicts/mobile/conflicts.mobile.test.tsx`, at `setViewport(390, 844)` with `installBackend()`:
rows >= 52px class and checkbox toggles stage via the same mocked bindings as `staging.test.tsx`; simulated swipe stages and unstages; tapping a row pushes `worktreeDiff` and renders unified-only content; "Stage hunk" calls the hunk staging binding with the same arguments as desktop; composer disables Commit on empty summary, counts to 72, keeps the draft after `pop()` and re-open, amend pre-fills; IdentitySheet appears with Android platform mocked and missing identity, not with desktop mocks; conflicts Continue disabled until all files resolved and per-hunk "Use theirs" calls resolve with the expected content; OperationBanner compact shows Resolve; AI dialog renders as a sheet on compact and unchanged on desktop.

## Commits

`feat(mobile): add Changes screen with swipe staging`, `feat(mobile): add diff page with hunk staging`, `feat(mobile): add commit composer and identity prompt`, `feat(mobile): add conflicts and stash screens`, `feat(ai): render AI dialogs as sheets on compact layouts`.

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm vite build
```

## Acceptance criteria

- All tests above pass; all existing suites pass unchanged at the default (desktop) viewport.
- Only owned files changed; desktop DOM unchanged at regular layout (compact code lives in `mobile/` or behind `isCompact`).
- No new dependencies; no raw colors; touch targets use the S0 tokens.

## Out of scope / needs orchestrator

Line-level staging on compact (deferred), split diff on compact (deferred), free-text merge editor redesign.
