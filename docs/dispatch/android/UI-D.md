# UI-D: design-system mobile primitives

- Wave: 1 (parallel with R2, R1a, R1b-1, C1)
- Agent: `design-system-agent`, model **sonnet**
- Branch/worktree: `feat/mobile-ui-d-primitives`
- Read first: `docs/dispatch/android/COMMON.md`, `docs/PLAN.md` §11, `docs/MOBILE_DESIGN.md` §4 (Interactions: touch targets, sheets, swipe, pull-to-refresh, command palette, safe areas, soft keyboard), §5 (components), §6; `docs/DESIGN.md` rules; S0 contract in `src/app/layout/{useLayout.ts,back.ts,useBackHandler.ts}` and `src/test/viewport.ts` (already merged).
- Frontend only: no cargo.

## Goal

Ship the touch-first components and hooks that packages A, B and C compose, with the exact APIs below, documented on `/design` and in `docs/DESIGN.md`. Existing components gain only additive `coarse:` / `compact:` classes, so desktop renders identically.

## Owned files

Create in `src/design/components/`: `Sheet.tsx`, `ActionSheet.tsx`, `ResponsiveDialog.tsx`, `AppBar.tsx`, `BottomNav.tsx` (exports `BottomNav` and `NavRail`), `SwipeRow.tsx`, `PullToRefresh.tsx`, `ListRow.tsx`, `mobile.test.tsx`.
Create `src/design/hooks/useLongPress.ts`, `src/design/hooks/useKeyboardInset.ts`, `src/design/hooks/index.ts`.
Modify: `src/design/components/index.ts` (exports), `Button.tsx`, `IconButton.tsx`, `Checkbox.tsx`, `Switch.tsx`, `SegmentedControl.tsx`, `Input.tsx`, `Tooltip.tsx`, `Toaster.tsx`, `CommandPalette.tsx` (additive variants only), `src/design/theme.tsx` (only: keep a `<meta name="theme-color">` in sync with `--bg`), `src/design/tokens.css` (may add tokens; must not change existing values), `src/design/DesignPage.tsx`, `docs/DESIGN.md`.

Must NOT touch: `src/index.css`, `index.html`, `src/app/**`, `src/features/**`, `src/stores/**`, `src/ipc/**`, `package.json` (no new dependencies: no vaul, no gesture libs).

## Contract (A, B and C code against these; keep names and prop types exactly)

```ts
// Sheet.tsx: bottom sheet on @radix-ui/react-dialog
export function Sheet(props: DialogPrimitive.DialogProps): JSX.Element;
//   Controlled or uncontrolled. While open, registers useBackHandler(() => { close(); return true }).
export const SheetTrigger: typeof DialogPrimitive.Trigger;
export const SheetClose: typeof DialogPrimitive.Close;
export interface SheetContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  snap?: "auto" | "full";      // auto: content height, max 85dvh (default); full: 100dvh minus safe-top
  dragToDismiss?: boolean;     // default true; handle drag past 30% height or velocity > 0.5 px/ms closes
  hideHandle?: boolean;
}
export function SheetContent(props: SheetContentProps): JSX.Element;
export function SheetHeader(props: HTMLAttributes<HTMLDivElement>): JSX.Element;
export function SheetFooter(props: HTMLAttributes<HTMLDivElement>): JSX.Element; // sticky bottom, pads --safe-bottom
export function SheetTitle(props: ComponentProps<typeof DialogPrimitive.Title>): JSX.Element;
export function SheetDescription(props: ComponentProps<typeof DialogPrimitive.Description>): JSX.Element;

// ActionSheet.tsx
export interface ActionSheetItem {
  id: string; label: string; icon?: ReactNode; description?: string;
  destructive?: boolean; disabled?: boolean; onSelect: () => void;
}
export interface ActionSheetProps {
  open: boolean; onOpenChange: (open: boolean) => void;
  title: string; description?: string;
  items: ActionSheetItem[];      // rows are --touch-target-row high; destructive rows use --danger
  groups?: ActionSheetItem[][];  // alternative to items: rendered with separators
  cancelLabel?: string;          // default "Cancel"
}
export function ActionSheet(props: ActionSheetProps): JSX.Element; // selecting a row closes, then calls onSelect

// ResponsiveDialog.tsx: Dialog on regular, Sheet (snap "full" unless overridden) on compact
export function ResponsiveDialog(props: DialogPrimitive.DialogProps): JSX.Element;
export const ResponsiveDialogTrigger, ResponsiveDialogClose;
export function ResponsiveDialogContent(
  props: ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean; snap?: "auto" | "full" },
): JSX.Element;
export function ResponsiveDialogHeader, ResponsiveDialogFooter, ResponsiveDialogTitle, ResponsiveDialogDescription;
//   Same props as the Dialog* equivalents. On regular it must render exactly what Dialog* renders today
//   (same DOM and classes), so swapping Dialog -> ResponsiveDialog is a no-op on desktop.

// AppBar.tsx
export interface AppBarProps {
  title: ReactNode; subtitle?: ReactNode;
  onTitleClick?: () => void;                     // renders the title as a button (repo switcher)
  onBack?: () => void; backLabel?: string;       // default aria-label "Back"; 44px IconButton
  leading?: ReactNode; actions?: ReactNode;
  progress?: number | "indeterminate" | null;    // 2px accent line on the bottom edge
  className?: string; children?: ReactNode;      // children render under the bar row (e.g. a search field)
}
export function AppBar(props: AppBarProps): JSX.Element; // height --appbar-h + --safe-top, bg-chrome, border-b

// BottomNav.tsx
export interface NavItem { id: string; label: string; icon: ReactNode; badge?: number | boolean }
export interface BottomNavProps {
  items: NavItem[]; activeId: string;
  onSelect: (id: string) => void;               // also fired when re-tapping the active item
  hidden?: boolean;                             // e.g. while the keyboard is open
}
export function BottomNav(props: BottomNavProps): JSX.Element; // <nav aria-label="Primary">, aria-current="page"
export function NavRail(props: BottomNavProps): JSX.Element;   // vertical, width --navrail-w, pads --safe-left

// SwipeRow.tsx
export interface SwipeAction { label: string; icon?: ReactNode; tone: "success" | "danger" | "neutral"; onTrigger: () => void }
export interface SwipeRowProps {
  leftAction?: SwipeAction;   // revealed on the left edge by swiping RIGHT
  rightAction?: SwipeAction;  // revealed on the right edge by swiping LEFT
  disabled?: boolean; className?: string; children: ReactNode;
}
export function SwipeRow(props: SwipeRowProps): JSX.Element;
// Commit at 40% width or velocity > 0.5 px/ms; spring back over --swipe-duration; touch-action: pan-y.
// Each action is also a real <button> in the DOM (visually hidden until focused) for a11y and tests.

// PullToRefresh.tsx
export interface PullToRefreshProps {
  onRefresh: () => Promise<unknown>;
  getScrollElement?: () => HTMLElement | null; // default: its own wrapper is the scroller
  disabled?: boolean; label?: string; className?: string; children: ReactNode;
}
export function PullToRefresh(props: PullToRefreshProps): JSX.Element;
// Triggers when pulled > 64px while the scroller is at scrollTop 0; shows Spinner; role="status" text;
// sets overscroll-behavior-y: contain on the scroller.

// ListRow.tsx
export interface ListRowProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode; subtitle?: ReactNode; leading?: ReactNode; trailing?: ReactNode;
  chevron?: boolean; selected?: boolean; disabled?: boolean;
  onClick?: () => void;       // renders a <button> when set, otherwise a <div>
}
export const ListRow: ForwardRefExoticComponent<ListRowProps & RefAttributes<HTMLElement>>;
// min-h --touch-target-row (never fixed h), press state 120ms, text truncates.

// src/design/hooks (import from "@/design/hooks")
export interface LongPressOptions { delay?: number /* 450 */; slop?: number /* 8 */; disabled?: boolean; vibrate?: boolean /* true */ }
export function useLongPress(onLongPress: (e: ReactPointerEvent) => void, opts?: LongPressOptions): {
  onPointerDown; onPointerMove; onPointerUp; onPointerCancel; onPointerLeave; onContextMenu;
}; // spread onto the target; suppresses the native contextmenu; cancels on move > slop or scroll
export function useKeyboardInset(): number; // VisualViewport-based; writes --kb-inset on <html>; 0 without VisualViewport
```

Existing components (additive only):

- `Button`, `IconButton`, `Checkbox`, `Switch`, `SegmentedControl`, `Input`: `coarse:min-h-[var(--touch-target)]` (and `coarse:min-w-[var(--touch-target)]` for IconButton); small visuals keep their size via padding or an `::after` hit area. `Input` also gets `coarse:text-[16px]`.
- `Tooltip`: renders only its trigger when `useLayout().isCoarse` (the aria-label stays).
- `Toaster`: on compact, `offset`/`mobileOffset` so toasts sit above `calc(var(--bottomnav-h) + var(--safe-bottom))`.
- `CommandPalette`: on compact renders inside `Sheet` (snap "full", input at top); hides `Kbd` when coarse. Props unchanged.
- `theme.tsx`: maintain `<meta name="theme-color">` = computed `--bg` whenever the resolved theme changes (create the tag if missing).

## Steps

1. Hooks, then `Sheet` (+ back handler), `ActionSheet`, `ResponsiveDialog`, `ListRow`, `AppBar`, `BottomNav`/`NavRail`, `SwipeRow`, `PullToRefresh`.
2. Additive variants on existing components.
3. `/design`: a "Mobile" section with every new component in both themes inside a 390x844 device frame wrapped in `LayoutProvider force={{ isCompact: true, isCoarse: true }}`.
4. `docs/DESIGN.md`: a "Mobile" section (tokens, variants, components, rules: layout via `useLayout`, capabilities via `usePlatform`, never branch structure with CSS `hidden`).
5. Tests in `src/design/components/mobile.test.tsx` (fake timers and pointer events):
   Sheet has an accessible name, traps focus, closes on Escape, on back (`dispatchBack()` returns true and closes), and on a drag past threshold; ActionSheet selects and closes, destructive row styled; ResponsiveDialog renders Dialog markup at regular and a sheet at `setViewport(390, 844)`; SwipeRow fires `leftAction` on a 60% right swipe, springs back on 20%, exposes buttons; `useLongPress` fires at 450ms and cancels on an 9px move; BottomNav sets `aria-current` and fires `onSelect` on re-tap; PullToRefresh calls `onRefresh` after a 80px pull at scrollTop 0 and not when scrolled; coarse classes present on Button/IconButton/Checkbox/Switch/SegmentedControl/Input.
6. Commits: `feat(design): add mobile sheet, action sheet and responsive dialog`, `feat(design): add app bar, bottom nav, swipe row, pull to refresh and list row`, `feat(design): add touch sizing to existing components`, `docs(design): document mobile primitives`.

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm vite build
```

## Acceptance criteria

- Every export above exists with the stated props and is exported from `@/design/components` or `@/design/hooks`.
- All step-5 tests pass; `src/design/components/components.test.tsx` and the full suite pass unchanged.
- No raw hex/rgb; every new dimension is a token; desktop DOM of existing components unchanged at regular layout (`git diff` shows only appended classes / new branches behind `isCompact`/`isCoarse`).
- `/design` renders the Mobile section in both themes (check with `pnpm dev` and `/design`, report what you verified).

## Out of scope / needs orchestrator

App shell, nav store and screens (A, B, C). New npm dependencies or `src/index.css` changes: report instead.
