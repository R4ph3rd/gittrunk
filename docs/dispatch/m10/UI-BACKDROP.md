# UI-BACKDROP: WCAG-bounded mesh gradient with scroll parallax

- Wave: 1 (after C10 is merged; parallel with B10, UI-START, UI-PULLS, UI-TOPRIGHT)
- Agent: `design-system-agent`, model **sonnet**
- Branch/worktree: `feat/design-m10-backdrop`
- Read first: `docs/PLAN.md` §13 (item 3, "Backdrop performance"); `docs/DESIGN.md`; `src/design/tokens.css`; `src/design/contrast.test.ts`; `src/design/components/MeshBackdrop.tsx` (C10 stub, final props); `src/design/hooks/index.ts`; `src/features/graph/GraphView.tsx` (the list area and `listRef`).
- Frontend only: never run cargo, `pnpm bindings` or `pnpm tauri`.

## Goal

A Lovable-style blurry mesh gradient in the gittrunk palette (pinky-red accent, violet, warm orange on the neutral dark or light surface), drawn as **wavy organic blob shapes** (not a linear gradient) that **translate on X and a little on Y as the graph scrolls** (parallax). It sits behind the commit graph at a WCAG-bounded `subtle` intensity and on the Home page at a stronger `page` intensity (UI-START mounts that one). It is static under `prefers-reduced-motion` and consumers hide it when `AppSettings.backdrop` is false (the switch is added by UI-TOPRIGHT).

## Rules (every M10 brief)

- Repo `/home/user/gittrunk`, integration branch `claude/relaxed-allen-0mjwae`. Worktree: `git -C /home/user/gittrunk worktree add /home/user/wt-design-m10-backdrop -b feat/design-m10-backdrop claude/relaxed-allen-0mjwae`; work only there with absolute paths; `pnpm install --frozen-lockfile` once.
- Touch only "Owned files". Need a hook, type, store field or dependency? Do not edit it: list it under "Needs orchestrator" and work around locally.
- Colors only in `src/design/tokens.css`; components use `var(--token)`. No Tailwind palette classes.
- Tests: Vitest + Testing Library; graph tests use `installBackend()`, `installDomShims()`, `resetStore()`, `renderApp()` from `src/app/testing.tsx` with `vi.mock("@/ipc/bindings", ...)` and `vi.mock("sonner", ...)` as the existing graph tests do. Whole suite green; foreign assertions you break are adapted in a separate `test(<scope>)` commit and listed.
- e2e invariants (keep): graph grid `aria-label="Commit graph"` with `role="row"` rows, rows clickable and draggable (`span[data-kind="localBranch"]` labels); the backdrop must never intercept pointer events or focus.
- Commits: Conventional Commits with a scope, made with
  `git -c user.name=Claude -c user.email=noreply@anthropic.com commit --author="R4ph3rd <43202876+R4ph3rd@users.noreply.github.com>" -F - <<'EOF' ... EOF`; every message ends with a blank line and exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FzHMmoKCskK5U6Gdp6AZmv
  ```
  Do not push, rebase or merge.
- Report back: branch and hashes; every gate with exit code; acceptance one line each; the final alpha values and the contrast ratios they produce; deviations; "Needs orchestrator"; foreign tests adapted.

## Owned files

Modify: `src/design/tokens.css` (backdrop tokens; see "Light theme headroom" for the only other allowed change), `src/design/contrast.test.ts` (new backdrop suite), `src/design/components/MeshBackdrop.tsx` (replace the stub, keep the exported name and props exactly), `src/design/hooks/index.ts` (one export), `src/design/DesignPage.tsx` (demo), `docs/DESIGN.md`, `src/features/graph/GraphView.tsx` (mount only).
Create: `src/design/mesh.ts`, `src/design/mesh.test.ts`, `src/design/hooks/usePrefersReducedMotion.ts`, `src/design/components/meshBackdrop.test.tsx`, `src/features/graph/backdrop.test.tsx`.
Must NOT touch: `src/index.css` unless a token must be mapped to a Tailwind utility (then report it), `src/stores/**`, `src/ipc/**`, other graph files (`GraphRowView.tsx`, `draw.ts`, `layout.ts`, ...), `src/features/home/**`, `src/features/settings/**`.

## Contract (keep exactly; created by C10)

```tsx
export interface MeshBackdropProps {
  intensity: "subtle" | "page";
  scrollRef?: RefObject<HTMLElement | null>;
  scrollKey?: string | number;
  className?: string;
}
export function MeshBackdrop(props: MeshBackdropProps): JSX.Element;
// root keeps: aria-hidden, data-testid="mesh-backdrop", data-intensity={intensity},
// "pointer-events-none absolute inset-0 overflow-hidden" + className
```

Consumers place it as the first child of a `relative isolate` container and render it only when `useSettings().backdrop` is true.

## 1. Tokens (`tokens.css`, both themes)

```css
--backdrop-1: <accent hue>; /* dark #ff4f7b, light #d6195a (same as --accent) */
--backdrop-2: <violet>; /* dark #a78bfa, light #7c3aed (lane-3) */
--backdrop-3: <warm orange>; /* dark #ff8a4c, light #c2410c (lane-5) */
--backdrop-alpha-subtle: <n>; /* peak opacity of each blob behind the graph */
--backdrop-alpha-page: <n>; /* peak opacity of each blob on Home */
--backdrop-blur-subtle: 56px;
--backdrop-blur-page: 96px;
```

Hex values are allowed here (this is the token file). Pick the alphas from the contrast constraints below, then round down. The orchestrator's worst-case computation (all three blobs fully stacked at peak alpha) gives these upper bounds; verify them in your test:

| Theme | Base                | Constraint                                                | Max per-blob alpha |
| ----- | ------------------- | --------------------------------------------------------- | ------------------ |
| dark  | `--surface` (graph) | fg, fg-muted, fg-subtle, accent ≥ 4.5:1; lanes ≥ 3:1      | ≈ 0.037            |
| light | `--surface` (graph) | same                                                      | ≈ 0.025            |
| dark  | `--bg` (Home)       | fg and fg-muted ≥ 4.5:1 (other text sits on opaque cards) | ≈ 0.125            |
| light | `--bg` (Home)       | fg and fg-muted ≥ 4.5:1                                   | ≈ 0.12             |

So suggested starting points: `--backdrop-alpha-subtle: 0.035` dark / `0.02` light, `--backdrop-alpha-page: 0.12` dark / `0.11` light. The graph effect is deliberately faint; that is the WCAG requirement, do not exceed it.

**Light theme headroom (optional):** if the light graph backdrop is invisible at 0.02, you may darken light `--fg-subtle` slightly (for example `#6b6b74` → `#63636b`) to gain headroom, keeping every existing assertion in `contrast.test.ts` green, and report the change. No other existing token may change.

## 2. Contrast test (`contrast.test.ts`)

Add `describe("backdrop", ...)` that, for each theme, parses the backdrop tokens and composites `--backdrop-1`, `-2`, `-3` **all stacked** (sequential alpha blending at the peak alpha) over the base color, then asserts:

- `subtle` over `--surface`: `--fg`, `--fg-muted`, `--fg-subtle`, `--accent` ≥ 4.5:1 and every `--lane-0..7` ≥ 3:1;
- `page` over `--bg`: `--fg`, `--fg-muted` ≥ 4.5:1.

Reuse the file's existing parsing helpers (extend `resolveColor` if needed). This test is the WCAG guarantee: the alphas are only valid while it passes.

## 3. Shapes and parallax math (`mesh.ts`, pure, unit-tested in `mesh.test.ts`)

```ts
export interface BlobSpec {
  /** Token index 1..3 (--backdrop-N). */
  color: 1 | 2 | 3;
  /** Position and size in % of the container. */
  x: number;
  y: number;
  size: number;
  /** Parallax: horizontal and vertical amplitude in px, period in px of scroll, phase in radians. */
  ampX: number;
  ampY: number;
  period: number;
  phase: number;
  seed: number;
}
export const BLOBS: readonly BlobSpec[]; // 3 blobs, distinct colors and phases
/** Smooth closed SVG path ("M ... C ... Z") of a wavy organic blob in a 100x100 box. Deterministic per seed. */
export function blobPath(seed: number, points?: number): string;
/** Parallax offset for a scroll position. Bounded: |x| <= ampX, |y| <= ampY. */
export function blobOffset(scrollTop: number, blob: BlobSpec): { x: number; y: number };
```

- `blobPath`: 6-8 points on a circle with radii jittered by a seeded PRNG (e.g. mulberry32), joined with Catmull-Rom → cubic Béziers; output closed, finite numbers, within 0..100.
- `blobOffset`: `x = ampX * sin(2π·scrollTop/period + phase)`, `y = ampY * sin(2π·scrollTop/(1.6·period) + phase)`. Use `ampX` 40-90 px, `ampY` ≤ 20 px, `period` 1200-2400 px: X dominates, Y is "a little".
- Tests: determinism, closed paths, finite and bounded coordinates, offsets bounded, `blobOffset(0, b)` equals the phase position, different blobs move differently.

## 4. Component (`MeshBackdrop.tsx`) and hook

- `usePrefersReducedMotion(): boolean` (`src/design/hooks/usePrefersReducedMotion.ts`, exported from `hooks/index.ts`): `matchMedia("(prefers-reduced-motion: reduce)")`, live updates, `false` when `matchMedia` is unavailable (jsdom).
- Render one absolutely positioned wrapper per blob (`left/top/width/height` from the spec in %, `will-change: transform`), containing an `<svg viewBox="0 0 100 100" preserveAspectRatio="none">` with one `<path d={blobPath(seed)} fill="var(--backdrop-N)" />`; the wrapper has `opacity: var(--backdrop-alpha-<intensity>)` and `filter: blur(var(--backdrop-blur-<intensity>))`. Nothing animates while idle (no CSS keyframes).
- Parallax: when `scrollRef` is given and reduced motion is off, subscribe to the element's `scroll` event (`passive: true`) in an effect keyed on `[scrollRef, scrollKey, reduced]`; coalesce with `requestAnimationFrame`; write `transform: translate3d(x px, y px, 0)` **directly on the wrapper elements via refs** (no React state per scroll). Clean up the listener and pending frame. Reduced motion or no `scrollRef`: transforms stay at the static (phase) position.
- `meshBackdrop.test.tsx`: renders 3 blobs with `var(--backdrop-N)` fills and the intensity's opacity variable; `aria-hidden` and `pointer-events-none`; a scroll event on the given element (stub `requestAnimationFrame` to run synchronously) changes the wrappers' `transform`; with `matchMedia` mocked to reduce motion, it does not; unmount removes the listener.

## 5. Graph mount (`GraphView.tsx`, desktop only)

- In the list container (`relative min-h-0 flex-1`) add `isolate` and render, as its first child, `{backdrop && <MeshBackdrop intensity="subtle" scrollRef={listRef} scrollKey={generation} />}` where `backdrop = useSettings().backdrop` (`src/stores/settings.ts`). The rows, the canvas and the WIP row keep their current layering above it (rows are transparent; selected/hover backgrounds stay as they are).
- The compact history list (`GraphList` used directly by mobile screens) gets no backdrop.
- `src/features/graph/backdrop.test.tsx`: with `renderApp()` and a repo open, the graph area contains `data-testid="mesh-backdrop"` with `data-intensity="subtle"`; with `settingsGet` returning `backdrop: false` it is absent; rows are still clickable (select a row and see the commit details).

## 6. Docs and demo

- `docs/DESIGN.md`: replace "Gradients appear only on app chrome and empty states; content surfaces are flat." with the new rule (chrome and empty states, plus the `MeshBackdrop` behind the graph and on Home, bounded by the contrast test); add the backdrop tokens to the Gradient table and a short "MeshBackdrop" component section (props, placement, reduced motion, setting).
- `DesignPage.tsx`: a demo panel with both intensities over a scrollable list.

## Prove it

```bash
cd /home/user/wt-design-m10-backdrop && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm build
```

## Acceptance criteria

- Tests above pass (contrast suite included); whole suite green; lint/format/typecheck/build exit 0.
- No hex/rgb outside `tokens.css`; blob colors and alphas only from tokens.
- No React re-render per scroll event (transforms written through refs); no idle animation; static under reduced motion.
- The backdrop never receives pointer events or focus; graph interactions unchanged.

## Commits

`feat(design): backdrop tokens bounded by a WCAG contrast test`, `feat(design): MeshBackdrop with organic blobs and scroll parallax`, `feat(graph): subtle backdrop behind the commit graph`, `docs(design): document the backdrop`.

## Conflicts

- `GraphView.tsx`: only you edit it in M10.
- `tokens.css` and `contrast.test.ts`: only you edit them in M10.
- Home uses your component (UI-START) through the props only; do not edit Home files.

## Out of scope / needs orchestrator

The Settings switch (UI-TOPRIGHT), the Home mount (UI-START), animated idle motion, backdrops on other panels.
