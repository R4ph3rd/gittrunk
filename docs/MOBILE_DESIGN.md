# Mobile (Android) design spec

The same React frontend ships inside the Tauri 2 Android app. This spec adapts the existing UI responsively; it does not define a second app. Desktop rendering must stay pixel-identical: every mobile change is gated behind the `compact` layout and is additive.

Visual language is unchanged (`docs/DESIGN.md`): tokens in `src/design/tokens.css`, flat content surfaces, `--gradient-chrome` only on chrome and empty states, motion 120-180ms.

## 1. Targets, breakpoints, detection

| Target          | Viewport (dp)                    | Layout                                                                                                                                                              |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone portrait  | 360-430 wide (design at 390x844) | `compact`, single pane, bottom nav                                                                                                                                  |
| Phone landscape | 640-932 wide, 360-430 tall       | `compact` + `short` (height < 480): bottom nav becomes a left rail, AppBar shrinks to 40px, commit composer opens as a sheet                                        |
| Tablet          | >= 768 wide                      | Existing desktop layout (`Group` of sidebar / graph / details in `RepoView`), with touch affordances (44px targets, long-press) still enabled via `pointer: coarse` |

Rule: a large phone in landscape (e.g. 932dp wide) is still `compact` because it is short. Layout is decided by width AND height, not width alone.

### Tokens (add to `src/design/tokens.css`, mapped in `src/index.css` `@theme inline`; request the mapping change from the orchestrator)

```css
--bp-compact: 768px; /* documentation token; media queries cannot read vars */
--touch-target: 44px; /* min interactive size on coarse pointers */
--touch-target-row: 52px; /* list rows (files, refs, commits) */
--appbar-h: 48px;
--bottomnav-h: 56px;
--sheet-radius: var(--radius-lg);
--sheet-handle: 32px;
--safe-top: env(safe-area-inset-top, 0px);
--safe-bottom: env(safe-area-inset-bottom, 0px);
--safe-left: env(safe-area-inset-left, 0px);
--safe-right: env(safe-area-inset-right, 0px);
--kb-inset: 0px; /* set by useKeyboardInset(), see section 4 */
--font-scale: 1; /* reserved; Android font scale arrives through rem */
```

Tailwind: register custom variants in `src/index.css` so classes read naturally and desktop classes stay untouched:

```css
@custom-variant compact (@media (max-width: 767.98px), (max-height: 479.98px) and (max-width: 1023.98px));
@custom-variant coarse (@media (pointer: coarse));
@custom-variant short (@media (max-height: 479.98px));
```

Usage: `compact:hidden`, `coarse:min-h-[var(--touch-target)]`. Existing classes are never edited except by appending variant-prefixed classes, so desktop output is identical (verified by the unchanged desktop tests plus the snapshot check in package A's acceptance).

### Detection: `useLayout()`

New file `src/app/layout/useLayout.ts` (package A):

```ts
export type LayoutMode = "compact" | "regular";
export interface Layout {
  mode: LayoutMode;
  isCompact: boolean;
  isShort: boolean;
  isCoarse: boolean;
}
export function useLayout(): Layout; // useSyncExternalStore over 3 matchMedia queries
export function LayoutProvider(props: { force?: Partial<Layout>; children }): JSX.Element; // tests + /design
```

- Queries mirror the CSS variants above exactly (single source: `src/app/layout/queries.ts` exports the strings; CSS carries a comment pointing at it and a test asserts equality by parsing `index.css`).
- SSR/jsdom fallback: no `matchMedia` means `regular` (existing tests keep passing untouched).
- CSS decides styling; `useLayout()` decides structure (which tree renders, e.g. `Group` vs. stack navigator). Never branch structure with CSS `hidden`, because it double-mounts queries and canvases.
- Container queries (`@container`) are used only inside components that can appear at several widths (diff viewer hunk header, file row meta), not for global layout.
- Viewport meta becomes `width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content` in `index.html`; `html` gets `overscroll-behavior: none` and `touch-action: manipulation` (kills the 300ms delay and double-tap zoom) on compact only.

## 2. Information architecture

### Shell on phone

Desktop: `RepoTabs` (top) + `RepoView` (sidebar | graph | details/staging) + `StatusBar`.
Phone: one screen at a time, `AppBar` on top, `BottomNav` at the bottom, drill-down pages pushed over the tab root.

```
Bottom tabs (BottomNav)            Root screen (component reused)
  History   (GitCommitVertical)    GraphView (compact list mode)  -> Commit detail (push)
  Changes   (FileDiff, count dot)  StagingPanel (compact split)   -> File diff (push), Commit composer
  Branches  (GitBranch)            RefsSidebar (compact page)     -> Remotes/Tags/Stash/Worktrees sections
  More      (Menu)                 MoreScreen: Stash, Reflog, AI, Settings, Repos, Help
```

- Selection state stays in the Zustand `useRepoStore`. `wip` selection is no longer what switches panes on phone; the tab does. Tapping the WIP row in History switches to the Changes tab (`selectWip`), and selecting a commit pushes Commit detail.
- Navigation state lives in a new store `src/stores/nav.ts` (package A): `{ tab, stack: Route[] }`, per repo, with `push`, `pop`, `resetTab`. Routes are typed unions: `{name:"commit", oid}`, `{name:"file", path, staged, source}`, `{name:"compose"}`, `{name:"conflict", path}`, `{name:"settings", section?}`, `{name:"blame"|"fileHistory"|"reflog", ...}`.
- No URL router is added (the app has none besides the dev `/design` route); the store is the router.
- Re-tapping the active tab pops to its root, then scrolls to top (Android convention).

### Repo switcher

`RepoTabs` is replaced on compact by `AppBar` with a title button "demo v" (repo name + current branch as subtitle). Tap opens a `Sheet` "Repositories": list of `useRepoStore().repos` (radio semantics, close button per row via swipe-left or trailing icon), "Open folder" (`pickAndOpen`, Android SAF picker), "Clone repository" (`setCloneOpen`), recent repos from `useRecentRepos`. Zero repos renders `Welcome` full screen with no BottomNav.

### v1 scope

| Feature                                                   | v1 phone                                         | Notes                                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open / clone / recent                                     | yes                                              | Clone via https + token (askpass bridge exists); SSH keys deferred unless the Rust side supports it                                                                                                                                                                |
| Graph / history, search, filters                          | yes                                              | List mode with mini lane gutter, not a free canvas (see section 4)                                                                                                                                                                                                 |
| Commit detail, file list, unified diff                    | yes                                              | Split diff deferred                                                                                                                                                                                                                                                |
| Stage / unstage file, discard, commit, amend              | yes                                              | Line and hunk staging: v1 hunk-level via long-press on hunk header; line-level selection deferred                                                                                                                                                                  |
| Fetch / pull / push                                       | yes                                              | Pull-to-refresh = fetch; pull/push in Branches and AppBar overflow                                                                                                                                                                                                 |
| Branch create / checkout / delete / rename                | yes                                              | Via action sheet                                                                                                                                                                                                                                                   |
| Merge, cherry-pick, revert, reset, tag                    | yes                                              | Menu actions on the commit/branch action sheet, with existing preview-and-confirm (`ConfirmDialog`, adapted as a full-height sheet)                                                                                                                                |
| Stash save / apply / pop / drop                           | yes                                              | More > Stash                                                                                                                                                                                                                                                       |
| Conflict resolution                                       | yes, reduced                                     | Per-file ours / theirs / both choice + per-hunk pick; free-text merge editor (`ConflictEditor`, CodeMirror) deferred behind "Edit manually" full-screen page                                                                                                       |
| AI commit message, summaries, Ask AI                      | yes                                              | Dialogs become sheets; same payload preview                                                                                                                                                                                                                        |
| Settings                                                  | yes                                              | General, Git, AI; Keyboard section hidden (no hardware keyboard requirement)                                                                                                                                                                                       |
| Undo / redo                                               | yes                                              | Toast with Undo action after each mutation; history in More                                                                                                                                                                                                        |
| Drag-and-drop merge/rebase/cherry-pick (`operations/dnd`) | deferred                                         | Replaced by "Merge into current...", "Rebase onto...", "Cherry-pick" menu actions using the same `resolve.ts` + preview pipeline. Reason: two-handle drags across a scrolling virtualized list are error-prone on touch and the resulting operation is destructive |
| Interactive rebase editor (`RebaseEditor`)                | deferred                                         | Needs reorder + 4 actions per row; v2 with a sortable list using dnd-kit `TouchSensor`                                                                                                                                                                             |
| Blame, file history, reflog                               | file history + reflog v1 (plain lists), blame v2 |                                                                                                                                                                                                                                                                    |
| Submodules, worktrees                                     | deferred                                         | Hidden on compact (`SidebarSections` sections not rendered)                                                                                                                                                                                                        |
| Keybinding editor, shortcut help                          | deferred                                         | Not applicable to touch                                                                                                                                                                                                                                            |
| Multiple tabs                                             | yes via repo switcher                            |                                                                                                                                                                                                                                                                    |

## 3. Screens

Common frame: `AppBar` (48px + safe-top), content, `BottomNav` (56px + safe-bottom) on tab roots only. `OperationBanner` (sequencer state) renders under the AppBar, sticky. `StatusBar` content moves into the AppBar subtitle and the More screen; op progress (`OpIndicator`) becomes a 2px accent progress line at the AppBar bottom edge plus a tap-to-expand sheet.

### 3.1 Repo picker / clone (`Welcome`, `CloneDialog`)

```
+--------------------------------+
|            (git icon)          |   gradient chrome background
|      Open a repository         |
|  [ Open folder            ]    |   Button lg, full width, 48px
|  [ Clone repository       ]    |
|  RECENT                        |
|  demo                          |   rows 56px
|  /storage/emulated/0/...       |   mono, truncated middle
+--------------------------------+
```

Clone opens as a full-height `Sheet` (URL, destination name, credential token field, progress with cancel). Destination is app-private storage by default; SAF folder optional. Pasting a URL from the clipboard is offered as a chip.

### 3.2 Commit graph / history (`GraphView`, `GraphRowView`, `WipRow`, `GraphToolbar`)

```
+--------------------------------+
| demo v  main            (S)(F) |  AppBar: repo switch, search, fetch/sync menu
|--------------------------------|
| [Search commits...]  [filter]  |  collapsed under AppBar; scroll-hidden
| * // WIP  3 staged 2 unstaged >|  WipRow -> Changes tab
| |\  Merge feature/x     a1b2c3d|
| | * Fix parser   [feature/x]   |  ref chips wrap on line 2
| * | Add tests     Ana  2h      |
+--------------------------------+
| History  Changes  Branches More|
+--------------------------------+
```

- Row height: `ROW_HEIGHT` 28 (`src/features/graph/layout.ts`) becomes `ROW_HEIGHT_COMPACT` 56 (two lines: subject; author, relative time, short hash in `font-mono`, ref chips). Lane geometry scales: lane pitch 14px (was 12), node radius 4. `draw.ts` already takes layout constants; make them parameters (`GraphMetrics`) so desktop values are the default.
- Tap: push Commit detail. Long-press (450ms, haptic tick): commit action `Sheet` (section 4).
- Filter and search reuse `FilterPopover` content inside a `Sheet`.
- Fetch: pull-to-refresh on the list.

### 3.3 Commit detail (`CommitDetailsPanel`)

```
+--------------------------------+
| <  a1b2c3d              (...)  |  AppBar with back, overflow = commit actions
|--------------------------------|
| Fix parser edge case           |  subject, text-lg
| body text (collapsible >6 ln)  |
| Ana <ana@x>  -  2h ago         |
| parents: 9f8e7d6  5c4b3a2      |  mono chips, tappable (jump)
| [AI summary]                   |
|--------------------------------|
| 4 files  +23 -5                |
| M src/parser.ts        +12 -3  |  FileRow (52px) -> file diff
| A src/new.ts           +11     |
+--------------------------------+
```

No BottomNav on drill-down pages (more room, consistent back).

### 3.4 Changes / staging and diff (`StagingPanel`, `FileList`, `CommitBox`, `diff/DiffViewer`)

Changes tab root:

```
+--------------------------------+
| Changes  2 staged 3 unstaged   |  AppBar; action: Stash
|--------------------------------|
| STAGED (2)          [Unstage all]
| [x] M src/a.ts            >    |  FileRow: checkbox (44px hit), path, status badge
| [x] A src/b.ts            >    |  swipe left = unstage, tap row = diff
| UNSTAGED (3)          [Stage all]
| [ ] M src/c.ts            >    |  swipe right = stage, swipe left = discard (confirm)
|--------------------------------|
| +-- Commit message ----------+ |  sticky ComposerBar: 1-line summary field
| | Summary...      [Commit 2] | |  tap = expands to compose page
+--------------------------------+
| History  Changes  Branches More|
+--------------------------------+
```

- File list on phone is a flat two-section list (`FileList` already models sections and `rows`); tree view mode hidden. The `ResizablePanelGroup` of list over diff is not rendered; opening a file pushes the File diff route. `StagingPanel`'s `effectiveOpen` logic is reused (file follows stage/unstage while the diff route is open).
- Diff route: AppBar shows filename (truncate start) and a prev/next file pair; content is `DiffViewer` forced to unified mode, horizontally scrollable code with sticky line-number gutter; hunk header has a "Stage hunk" / "Unstage hunk" button (44px). Long-press a hunk = hunk sheet (stage, discard). Line-level selection (`diff/selection.ts`) is disabled on compact in v1. Font: `--font-mono` at 12px (scales with font size).
- Large diffs: `DiffViewer` is already lazy-loaded; keep it, add "Load full diff" gate above 2000 lines.

### 3.5 Commit composer (`CommitBox`)

Compose page (pushed from ComposerBar, or inline when the keyboard opens):

```
+--------------------------------+
| x  Commit           [Commit]   |  AppBar: close, primary action (enabled when valid)
|--------------------------------|
| Summary                  38/72 |  Input, counter turns warning >72
| [sparkle AI message]           |  AiCommitMessageButton
| Description                    |  Textarea, grows
| [ ] Amend last commit          |  Switch rows, 52px
| [ ] Sign off                   |
| 2 staged files (tap to review) |
|                     (keyboard) |  content lifted by --kb-inset
+--------------------------------+
```

`message.ts` validation reused unchanged. Draft persists in the store so back-swiping does not lose text; leaving with a non-empty draft does not prompt.

### 3.6 Branches / remotes (`RefsSidebar`, `SidebarParts`, `RemotesSection`, `RemoteToolbar`)

```
+--------------------------------+
| Branches               (+) (F) |  new branch, fetch
| [Local | Remote | Tags]        |  SegmentedControl replaces collapsible sections
| * main      up1 down0     v    |  row 52px; current marked with accent dot
|   feature/x  up0 down3         |  tap = action sheet; long-press same
+--------------------------------+
```

- Sections become `SegmentedControl` pages: Local, Remotes (grouped per remote, add/edit via `RemoteFormDialog` sheet), Tags. Stash lives under More.
- Row tap opens the ref action `Sheet` (Checkout, Merge into current, Rebase current onto, Push, Set upstream, Rename, Delete, Summarize with AI, Reflog). Mirrors `ContextMenuItem`s in `RefsSidebar` through the shared `entries.ts` registry so desktop and mobile menus cannot drift.
- Search field above list for repos with many refs.

### 3.7 Stash (`StashDialog`, `useStashActions`)

More > Stash: list of stashes, tap = action sheet (Apply, Pop, Drop, View diff as commit-like detail). "Stash changes" button opens a sheet with message input and "include untracked" switch (the `StashDialog` body, presented as `Sheet`).

### 3.8 Conflicts (`conflicts/ConflictResolver`, `OperationBanner`)

```
+--------------------------------+
| <  Resolve conflicts  2 left   |
|--------------------------------|
| src/a.ts            [resolved] |
| src/b.ts                    >  |
|--------------------------------|
| [Abort]           [Continue]   |  disabled until all resolved
+--------------------------------+
   file page:
| src/b.ts    conflict 1 of 3 v  |
| <<< ours (main)                |  card, tinted with --lane/ours token
|   const a = 1                  |
| >>> theirs (feature/x)         |
| [Use ours][Use theirs][Both]   |  Buttons 44px, per hunk
| [Suggest with AI] [Edit manually]
```

`OperationBanner` on compact becomes a sticky bar with Continue/Skip/Abort in an overflow sheet.

### 3.9 AI panel (`features/ai/*`)

All AI dialogs (`AskAiDialog`, `AiPrDescriptionDialog`, `AiSettingsDialog`, `PayloadPreview`, `PlanView`) render as full-height `Sheet`s via a `ResponsiveDialog` wrapper (Dialog on regular, Sheet on compact) in the design system, so feature code keeps the same props. Payload preview is a collapsible section above the primary "Send" button, sticky at the bottom. Entry points: composer (sparkle), commit detail (summary), More > Ask AI.

### 3.10 Settings (`SettingsDialog`)

Left-nav dialog becomes a page: list of sections (General, Git, AI) as 56px rows, drill into each section page with AppBar back. Switch rows are full-width tap targets. `KeyboardSection` is not rendered on compact. Opened from More; routes `{name:"settings"}` in the nav stack (not a modal) so Android back works naturally.

## 4. Interactions

**Touch targets.** Every interactive element >= 44x44 CSS px on `coarse` (`Button`, `IconButton`, `Checkbox`, `Switch`, `SegmentedControl` get `coarse:min-h-[var(--touch-target)]`; small visuals keep their size using padding or a pseudo-element hit area so desktop is unchanged). List rows 52px minimum. 8px minimum gap between adjacent targets.

**Context menus to long-press + sheet.** `ContextMenu` is replaced on compact by `useLongPress(450ms, 8px slop)` opening an `ActionSheet`. The registry in `src/features/operations/actions/{entries,openMenu,ActionMenu}.tsx` is the single source: `ActionMenu` renders `ContextMenuItem`s on regular and `ActionSheet` rows on compact. Long-press cancels on scroll, gives `navigator.vibrate(10)` where available, and suppresses the native `contextmenu` event. Every long-press action has a visible alternative (row overflow button `...` on rows with coarse pointer, since long-press is not discoverable). `Tooltip` is not shown on touch; `aria-label` remains.

**Sheets.** Design-system `Sheet` wraps `@radix-ui/react-dialog` (already a dependency; do not add vaul for v1, a bottom-anchored `DialogContent` variant with drag-to-dismiss written on pointer events is enough). Snap points: `auto` (content height, max 85dvh) and `full`. Drag handle 32x4, scrim `--overlay`, rounded top `--sheet-radius`, `padding-bottom: var(--safe-bottom)`, enter/exit 180ms translateY. Focus trap and `aria-modal` come from Radix; title required (visually hidden allowed).

**Swipe actions.** `SwipeRow` (pointer events + `touch-action: pan-y`): swipe right reveals Stage (success token), swipe left reveals Unstage or Discard (danger). Commit threshold 40% width or velocity > 0.5px/ms; partial swipe springs back in 150ms. Always paired with the checkbox and the overflow button (a11y: swipe is an accelerator only). Disabled when a screen reader is active is not detectable, so actions also expose as `role="button"` buttons in the DOM, visually revealed on focus.

**Pull-to-refresh.** `PullToRefresh` wrapper on History and Changes and Branches: overscroll > 64px triggers `fetch` (History, Branches) or `useStatus().refetch` (Changes). Uses the existing remote fetch action from `features/remotes/actions.ts`, shows `Spinner`, respects credential prompts. `overscroll-behavior-y: contain` on the scroller to stop Android's native refresh/glow interplay.

**Command palette / shortcuts.** `CommandPalette` (cmdk in Dialog) keeps working; on compact it renders as a full-height `Sheet` with the input at the top and is reached from a search icon in the AppBar and More > "Actions". Commands with `shortcut` hide the `Kbd` on coarse pointers. The shortcut engine (`src/app/shortcuts`) stays mounted for Bluetooth keyboards/DeX; no new bindings.

**Drag and drop.** v1 removes dnd from compact: `OperationsProvider` skips `DndContext` sensors (`useDndNode` returns inert props) when `isCompact`, and the "Merge/Rebase/Cherry-pick" menu actions call the same `resolve.ts` -> preview -> `ConfirmDialog` pipeline. Where dnd-kit is kept later (rebase todo reorder), use `TouchSensor` with `activationConstraint: { delay: 250, tolerance: 8 }` plus `PointerSensor` `distance: 6` on regular, a drag handle icon (44px) as the only drag source, and autoscroll from `autoscroll.ts`.

**Graph canvas.** History on phone is a virtualized list (existing `useVirtualizer` in `GraphView`) with the lane gutter drawn per row in the canvas at `dpr` (already read at `GraphView` line ~200). Vertical scroll = native. The gutter can be wide (many lanes): cap at 40% of width and allow horizontal pan of the gutter only via a 1-finger horizontal drag inside the gutter region (`touch-action: pan-y` on rows, `pan-x` inside gutter overlay); pinch-zoom not supported in v1 (fixed lane pitch, "Compact lanes" setting collapses to 8px pitch). Tap on gutter node = select commit.

**Safe areas.** `AppBar` pads `--safe-top`, `BottomNav` and sheets `--safe-bottom`, landscape rail/pages `--safe-left/right`. Tauri Android: edge-to-edge, status/navigation bar colors follow `--bg` (set via `theme-color` meta updated by `ThemeProvider`).

**Android back button.** `useBackHandler` in `src/app/layout/back.ts` maintains a LIFO stack of handlers; the Tauri Android back event (or `popstate` fallback, see below) calls the top handler. Priority order: (1) open overlay (Sheet/Dialog/ActionSheet/palette/toast-with-action) closes itself, (2) in-progress text composer with keyboard open blurs the field (keyboard hides first), (3) `nav.pop()` on drill-down, (4) tab not History goes to History, (5) History root: second press within 2s exits (toast "Press back again to exit"). Radix overlays register through `Sheet`/`Dialog` wrappers, so package D exposes `onOpenChange` to the stack. Implementation: on mount push a sentinel `history.pushState` entry and re-push it on each `popstate` (works in the webview without native code); a Rust-side `onBackPressed` hook is optional and swaps only the trigger.

**Soft keyboard.** With `interactive-widget=resizes-content` the layout viewport shrinks; `useKeyboardInset()` (VisualViewport fallback) writes `--kb-inset`. Composer page uses `dvh`, keeps the primary button in the AppBar so it is never covered, scrolls the focused field into view (`scrollIntoView({block:"center"})` after 100ms). `BottomNav` hides while an input is focused (`focusin` on text fields). Inputs are >= 16px font to avoid zoom; `enterkeyhint`, `autocapitalize="sentences"`, `spellcheck` on for messages; `autocapitalize="none"` and `autocorrect="off"` for branch names, URLs, paths.

## 5. Design-system components

New files in `src/design/components/`, exported from `index.ts`, documented in `docs/DESIGN.md`, all on `/design` (`DesignPage.tsx`) inside a "Mobile" section rendered in both themes with a `LayoutProvider force={{isCompact:true}}` framed 390x844 device frame.

| Component                                                              | Notes                                                                                                 | Tokens                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Sheet` (`SheetContent, SheetHeader, SheetTitle, SheetFooter`, `snap`) | Radix Dialog bottom variant, drag to dismiss, `aria-modal`                                            | `--bg-elevated`, `--border`, `--shadow-lg`, `--sheet-radius`, `--overlay`, motion 180ms |
| `ActionSheet` (`items: {icon,label,destructive,onSelect}[]`)           | 52px rows, destructive tinted, cancel row                                                             | `--danger`, `--touch-target-row`                                                        |
| `ResponsiveDialog`                                                     | Dialog on regular, Sheet on compact, same API as `Dialog`; adopt in `Dialog`-using features gradually | as above                                                                                |
| `AppBar` (`title, subtitle, onBack, actions, progress`)                | h-`--appbar-h`, safe-top, gradient chrome background, back is `IconButton` 44px `aria-label="Back"`   | `--gradient-chrome`, `--border`                                                         |
| `BottomNav` (`items: {id,label,icon,badge}[]`)                         | `role="tablist"`-style nav with `aria-current="page"`, active accent, badge dot for changes           | `--accent`, `--fg-muted`, `--bottomnav-h`                                               |
| `NavRail`                                                              | landscape variant of `BottomNav`                                                                      | same                                                                                    |
| `SwipeRow`                                                             | described above, exposes `leftAction/rightAction`                                                     | `--success`, `--danger`                                                                 |
| `PullToRefresh`                                                        | wraps scroller, `onRefresh(): Promise`                                                                | `--accent`                                                                              |
| `ListRow`                                                              | 52px row: leading, title, subtitle, trailing, chevron; press state 120ms                              | `--surface-hover`                                                                       |
| `FloatingAction` (optional)                                            | only for "new branch"; avoid elsewhere                                                                | `--accent`, `--shadow-md`                                                               |
| Hooks                                                                  | `useLongPress`, `useKeyboardInset`, `useLayout`, `useBackHandler`                                     | n/a                                                                                     |

Changes to existing: `Button`/`IconButton`/`Checkbox`/`Switch`/`SegmentedControl`/`Input` gain `coarse:` sizing; `Tooltip` renders children only on coarse; `Toaster` position bottom-center above `BottomNav` (offset `calc(var(--bottomnav-h) + var(--safe-bottom))`); `CommandPalette` -> Sheet on compact; `ContextMenu` usage goes through `ActionMenu`. No raw hex anywhere; every new dimension is a token above.

## 6. Accessibility and performance

- Font scaling: all type is `rem`-based; Android system font scale up to 200% must not clip. Rows use `min-h`, never fixed `h`, for text rows; graph rows may grow (variable-size virtualizer via `measureElement`), lane canvas is redrawn per row height.
- Contrast: existing tokens already target WCAG AA; verify `--fg-subtle` on `--surface` >= 4.5:1 for 12px mobile text, and raise the token if not (single-token change restyles everything).
- Reduced motion: `@media (prefers-reduced-motion: reduce)` collapses sheet, swipe spring and progress transitions to 0-1ms (implement once in tokens as `--motion-fast: 0ms`).
- TalkBack: `BottomNav` `aria-current`; sheets announce title; swipe actions have button equivalents; `role="status"` for pull-to-refresh and toasts; focus returns to the trigger on sheet close; long-press has an overflow-button alternative.
- Focus-visible stays for hardware keyboards; `:active` press states added on coarse pointers (no `:hover` styles under `@media (hover: none)`).
- Performance: keep virtualization (`@tanstack/react-virtual`, `PAGE_SIZE` windows); overscan 8 on compact; lazy-load `DiffViewer`, `ConflictEditor` (CodeMirror), `MiniGraph`; cap diff render at 2000 lines with a gate; cap `devicePixelRatio` for the graph canvas at 2.5 on compact (`Math.min(dpr, 2.5)`) and redraw only visible range; avoid `backdrop-filter` blur on sheets (use solid scrim); passive touch listeners except where `preventDefault` is needed (swipe with `touch-action: pan-y` avoids it); debounce search 150ms already present; query `staleTime` and refetch-on-focus tuned so returning from Android background triggers one status refetch, not a burst.

## 7. Work breakdown

Ownership is disjoint by file. Shared conventions live in package D and A's `useLayout`; everything else in packages B and C only imports from them. Merge order: D and A start in parallel (A only needs the `Sheet`/`AppBar` stubs' type signatures, agreed here), B and C start when D's exports land (or code against the signatures listed in section 5 with local stubs removed at merge).

### Package D - Design-system mobile primitives (owner: designer)

Files (create): `src/design/components/{Sheet,ActionSheet,ResponsiveDialog,AppBar,BottomNav,NavRail,SwipeRow,PullToRefresh,ListRow}.tsx`, `src/design/hooks/{useLongPress,useKeyboardInset}.ts`, `src/design/mobile.test.tsx`. Modify: `src/design/tokens.css`, `src/design/components/{index.ts,Button,IconButton,Checkbox,Switch,SegmentedControl,Input,Tooltip,Toaster,CommandPalette}.tsx` (coarse variants only), `src/design/DesignPage.tsx`, `docs/DESIGN.md`. Needs from orchestrator: `@custom-variant` and `@theme inline` additions in `src/index.css`.
Depends on: none.
Acceptance: `/design` shows every mobile component in both themes; snapshot-free tests: Sheet traps focus, closes on Escape and drag past threshold, has accessible name; SwipeRow fires stage on a simulated 60% pointer swipe and exposes buttons; `useLongPress` fires at 450ms and cancels on move > 8px (fake timers); BottomNav marks `aria-current`; all touch targets carry `min-h-[var(--touch-target)]` under `coarse`; existing `components.test.tsx` passes unchanged; `pnpm lint typecheck test` green.

### Package A - Layout shell, navigation, back handling (owner: app shell)

Files (create): `src/app/layout/{useLayout.ts,queries.ts,LayoutProvider.tsx,back.ts,useBackHandler.ts,MobileShell.tsx,MoreScreen.tsx,RepoSwitcherSheet.tsx}`, `src/stores/nav.ts`, `src/app/layout/layout.test.tsx`. Modify: `src/app/App.tsx` (branch `isCompact ? <MobileShell/> : existing tree`, existing JSX untouched), `src/app/testing.tsx` (add `setViewport(w,h)` matchMedia helper, default regular), `index.html` (viewport meta, exact string in section 1), `src/main.tsx` (mount `LayoutProvider`), `src/features/repo/{Welcome,RepoTabs}.tsx` (compact variants only), `src/features/settings/**` (settings page-in-stack on compact, owned by designer).
Depends on: D signatures for `AppBar`, `BottomNav`, `Sheet` (stub then swap).
Acceptance (Vitest + RTL, `setViewport(390, 844)`): renders BottomNav with 4 tabs and no `RefsSidebar`/resizable `Group`; at 1280x800 renders the existing desktop tree (all existing `App.test.tsx` and `commands.test.tsx` pass untouched); tab switch and re-tap-to-root work; `nav.push` shows a route with AppBar back, `back()` order is sheet -> pop -> tab -> exit toast (simulated `popstate`); repo switcher lists open repos and switches `activeId`; landscape (844x390) shows `NavRail`; matchMedia missing -> regular.

### Package B - Changes, staging, diff, composer, conflicts (owner: staging/operations-conflicts UI)

Files modify: `src/features/staging/{StagingPanel,FileList,CommitBox}.tsx` (compact branches, extracted to new `src/features/staging/mobile/{ChangesScreen,FileRow,DiffScreen,ComposerScreen,ComposerBar}.tsx`), `src/features/staging/diff/{DiffViewer,HunkView}.tsx` (forced unified + hunk buttons on compact), `src/features/operations/conflicts/mobile/{ConflictsScreen,ConflictFileScreen}.tsx` (new), `src/features/operations/sequencer/OperationBanner.tsx` (compact bar), `src/features/stash/StashDialog.tsx` + new `StashScreen.tsx`, `src/features/ai/**` dialogs switched to `ResponsiveDialog`, tests `src/features/staging/mobile/mobile.test.tsx`, `src/features/operations/conflicts/mobile/conflicts.test.tsx`.
Depends on: D (`SwipeRow`, `ListRow`, `Sheet`, `AppBar`, `ResponsiveDialog`), A (`nav` store routes and `useLayout`). Register routes `file`, `compose`, `conflict`, `stash`, `ai` through A's `MobileShell` route map (A defines the map interface `routes: Record<RouteName, ComponentType>`; B contributes entries in `src/features/staging/mobile/routes.ts` and `.../conflicts/mobile/routes.ts`, imported by A at integration).
Acceptance (390x844): file rows >= 52px with checkbox toggling stage through the same mock bindings as `staging.test.tsx`; simulated swipe stages/unstages; tapping a row pushes the diff route showing unified-only content; hunk "Stage hunk" calls the same `stageHunk` binding as desktop; composer disables Commit for empty summary, counts to 72, persists draft across back; amend switch prefilled; conflicts screen enables Continue only when all files resolved; all existing `staging.test.tsx`, `operations.test.tsx`, `ai.test.tsx` pass at desktop viewport.

### Package C - History, commit detail, branches, remotes (owner: graph/repo UI)

Files modify: `src/features/graph/{GraphView,GraphRowView,GraphToolbar,WipRow,draw,layout,FilterPopover}.ts(x)` (`GraphMetrics` params with desktop defaults; compact two-line row; DPR cap), `src/features/repo/{CommitDetailsPanel,RefsSidebar,SidebarParts,RepoView}.tsx` (compact extractions into `src/features/repo/mobile/{HistoryScreen,CommitScreen,BranchesScreen,RefRow}.tsx`), `src/features/operations/actions/{ActionMenu,openMenu}.tsx` (render `ActionSheet` on compact; shared entries), `src/features/operations/dnd/{OperationsProvider,useDndNode}.ts(x)` (inert on compact), `src/features/remotes/{RemoteToolbar,RemotesSection,RemoteFormDialog,CloneDialog}.tsx` (compact sheet variants), `src/features/history-views/**` (reflog, file history lists; hide submodules/worktrees/blame on compact), tests `src/features/repo/mobile/mobile.test.tsx`, `src/features/graph/metrics.test.ts`.
Depends on: D (`Sheet`, `ActionSheet`, `ListRow`, `PullToRefresh`, `useLongPress`), A (`nav` routes, `useLayout`).
Acceptance (390x844): history rows render 56px two-line with ref chips; tap pushes commit route; long-press (fake timers) opens the action sheet containing Checkout/Merge/Cherry-pick etc. with the same entries as desktop `entries.ts` (unit test compares ids); pull-to-refresh invokes fetch binding; WIP row switches to Changes tab; branches segmented control switches Local/Remotes/Tags; no dnd context sensors when compact; `draw.test.ts` and `layout.test.ts` pass unchanged with default metrics (desktop pixel-identical: same draw calls); existing `dnd.test.tsx`, `history-views.test.tsx`, `remotes.test.tsx` pass at desktop viewport.

### Cross-package rules

- Desktop guard: any PR must keep the full existing suite green with default viewport (jsdom has no `matchMedia` layout = regular). CI adds a mobile test project running only `*.mobile.test.tsx`/`mobile/` tests at 390x844 via `setViewport`.
- Only A edits `App.tsx`, `main.tsx`, `index.html`, `stores/nav.ts`; only D edits `src/design/**` and `docs/DESIGN.md`; B and C never edit each other's folders. Route map entries and `ActionMenu` are the integration seams.
- Manual QA matrix before release: Pixel 7 (412x915), small phone (360x640), foldable inner (~700x840, compact via width), tablet (800x1280, regular), landscape phone, font scale 1.3/2.0, TalkBack, dark and light, gesture and 3-button navigation.
