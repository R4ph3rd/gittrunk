# UI-GRAPH: refs column, avatar nodes, lane-colored chips, hover card

- Wave: 1
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/graph-m9`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.1 items 4, 10, 11, 12 and §12.2 (Graph geometry, Ref colors, Avatars); code: `src/features/graph/**`, merged contracts `src/ipc/queries.ts` (`useRefColors`, `fetchAvatars`, `avatarKey`, `useAvatar`, `useCommitDetails`), `src/lib/laneColor.ts`, `src/design/components/Avatar.tsx`, `src/design/tokens.css` (`--lane-*`, `--lane-fg`, `--avatar-ring`).
- Frontend only.

## Goal

The desktop commit list loses its author, date and oid columns. Branch and tag labels move to a refs column left of the lanes, colored with their lane. Commit nodes show the author's avatar (initials fallback). Hovering a row shows a card with date, oids and the full message. Every `RefBadge` in the app is lane-colored. Compact (mobile) rows keep their layout.

## Owned files

`src/features/graph/**` (all files and tests), new `src/features/graph/{CommitHoverCard.tsx,avatarImages.ts,refs.test.tsx,hover.test.tsx}`. Primary owner of `src/features/operations/operations.test.tsx` and `src/features/operations/dnd/dnd.test.tsx` (adapt only what your change breaks).
Must NOT touch: `src/features/repo/**`, `src/features/staging/**`, `src/app/**`, `src/ipc/**`, `src/design/**`, `src/stores/**`.

## Behavior

1. **Refs column (desktop variant only).** Constant `REFS_COLUMN_WIDTH = 176` in `layout.ts`. `DesktopRow` becomes `[refs cell 176px, right-aligned chips][lane gutter spacer][summary]`; the canvas is positioned at `left: REFS_COLUMN_WIDTH`. Show up to 2 chips (HEAD's branch first, then local, remote, tags); overflow as `+N` whose `title` lists the rest. Chips truncate at 150px with the full name in `title`. The canvas draws a 1px lane-colored connector from x=0 to the node's left edge on rows with refs. `WipRow` receives the same left offset (spacer of `REFS_COLUMN_WIDTH`). Compact rows unchanged.
2. **Lane-colored `RefBadge`.** Keep the export and props of `RefBadge`, add optional `color?: number`. When `color` is undefined, look it up with `useRefColors(useRepoStore(s => s.activeId))` by `label.fullName`; unknown -> neutral style. Colored style: text and border `laneVar(color)`, background `color-mix(in srgb, var(--lane-N) 16%, transparent)` via inline style; HEAD branch: filled `laneVar(color)` with `text-lane-fg` and a small dot/ring marker. Leading 12px icon by kind (`GitBranch` local, `Cloud` remote, `Tag` tag, `Archive` stash) with `aria-hidden`. Keep `data-kind`, `data-head`, `title={fullName}` and the text node equal to `label.name` (e2e matches `normalize-space()`). Graph rows pass `color={row.color}`. Keep the hook out of the hot path: `RefBadge` renders directly when `color` is given and delegates to an inner connected component (which calls `useRefColors`) only when it is not.
3. **Avatar nodes.** Desktop metrics: `nodeRadius 9`, `lanePitch 24`, `maxGutter 320`, `rowHeight 28` (update `DESKTOP_METRICS` and constants; `COMPACT_METRICS` values stay exactly as today). Non-merge commits draw an 18px circular avatar clipped to the node circle with a 2px `laneColor` ring and a 1px `--avatar-ring` separation; without an image, a lane-colored disc with `initials(row.authorName)` in `--lane-fg` (font from `--font-sans`, 600, 8px). Merge commits keep a small hollow node (radius 5). HEAD keeps the accent halo. `avatarImages.ts`: module cache `email -> HTMLImageElement | null | "loading"`; for rows in the draw range, missing emails are requested with `fetchAvatars(client, subjects, 64)` (debounced 50 ms, deduped), decoded with `new Image()`/`decode()`, then a redraw is requested. `readPalette()` also reads `--lane-fg`, `--avatar-ring`, `--font-sans`.
4. **Columns removed.** No author, date or short-oid gridcells in desktop rows. Each row keeps one visually hidden gridcell (`sr-only`) with `"<author>, <relative date>, <shortOid>"` so screen readers lose nothing.
5. **Hover card.** `CommitHoverCard.tsx` with `@radix-ui/react-hover-card`: opens after 500 ms on row hover (not while dragging, not on compact), closes 150 ms after leaving row and card; side `top`, collision-aware. Content: `Avatar` (via `useAvatar({ kind: "email", email })`) + author name + email; absolute date and relative date; short oid with a copy button and the full oid (mono, selectable) with a copy button (`navigator.clipboard.writeText` + toast "Copied"); the full message (`useCommitDetails` summary + body, fetched only when open, `whitespace-pre-wrap`, max height with scroll); ref chips. Styling: `bg-surface-raised`, `border-border`, `shadow-md`, max width 420px. Keyboard: `Alt+Enter` on the grid opens the card for the selected row (`Shift+F10` stays the context menu) and `Escape` closes it.

## Tests

Existing graph tests adapted to the new desktop metrics (`metrics.test.ts` asserts the new desktop values and unchanged compact values; `draw.test.ts` covers the connector, avatar draw with a fake image, initials fallback, merge node). New:

- `refs.test.tsx`: refs render in the refs column before the summary; `+N` overflow with title; `RefBadge` takes `color` from `row.color`, from `useRefColors` when omitted, neutral when unknown; `data-kind` and text preserved; no author/date/oid visible cells, sr-only cell present.
- `hover.test.tsx` (fake timers): hovering a row 500 ms opens the card with absolute date, short and full oid and the full message from `commitDetails`; copy buttons write to a mocked clipboard; leaving closes it; `Alt+Enter` opens it for the selected row.
- Avatar loader: visible rows trigger one `avatarsGet` call with deduped subjects; cached emails are not requested again.

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm vite build
```

## Acceptance criteria

- Tests above green; full suite green (adaptations outside `src/features/graph` listed in the report).
- e2e invariants of COMMON hold (rows, `data-kind` badges with exact text, `// WIP`).
- Compact history rows render as before (mobile tests untouched and green).
- No raw colors; lanes only through `laneVar`/palette.

## Commits

`feat(graph): move ref labels to a column left of the lanes`, `feat(graph): color ref chips with their lane`, `feat(graph): draw author avatars in commit nodes`, `feat(graph): replace author, date and oid columns with a hover card`.

## Out of scope / needs orchestrator

Resizable refs column, avatars in compact rows, graph column headers.
