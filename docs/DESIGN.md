# gittrunk design system

Source of truth: `src/design/tokens.css`. Tailwind utilities map to tokens in `src/index.css` (`@theme inline`). Components live in `src/design/components/` and are imported from `@/design/components`. The dev-only `/design` route shows every token and component in both themes.

Direction: Clerk, Linear, Vercel. Dark first plus a light theme, 13px base text, 28px default control (24px small), crisp 1px borders, subtle shadows, 120-180ms motion (durations collapse to ~0 under `prefers-reduced-motion`). Gradients appear on app chrome and empty states; content surfaces are flat, except for the `MeshBackdrop` blurred blobs behind the commit graph and on Home, whose strength is bounded by the contrast test.

## Rules

- No hex or rgb literals outside `src/design/tokens.css`. Use token classes (`bg-surface`, `text-fg-muted`, `border-border`, `bg-accent`, `bg-toolbar`, `text-staged`) or `var(--token)` arbitrary values (`h-[var(--control-md)]`, `bg-[color:var(--overlay)]`).
- Changing `--accent` restyles every accent use. Never hardcode a color class.
- Every interactive component shows a `:focus-visible` ring from `--focus-ring`.
- Tokens not mapped in `@theme inline` (control heights, z-index, overlay, scrollbar, danger-fg, terminal, lane-fg) are consumed through `var(--x)`.

## Theming

Wrap the app in `ThemeProvider` (from `src/design/theme.tsx`). It sets `data-theme="dark|light"` on `<html>`, supports `dark | light | system` (system follows `prefers-color-scheme` live) and persists the choice to `localStorage` (`gittrunk.theme`, failures ignored). `SettingsHost` keeps it in sync with the backend `theme` setting in both directions (dialog, "Toggle theme" command, startup load).

```tsx
<ThemeProvider defaultTheme="dark">
  <TooltipProvider>
    <App />
    <Toaster />
  </TooltipProvider>
</ThemeProvider>;
const { theme, resolvedTheme, setTheme } = useTheme();
```

## Tokens

Values shown as dark / light where they differ.

### Color

| Token                                                            | Dark / Light                                                                                | Use                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------- |
| `--bg`                                                           | `#0c0c0d` / `#fafafa`                                                                       | App background                |
| `--bg-subtle`                                                    | `#111113` / `#f4f4f5`                                                                       | Inputs, code wells            |
| `--surface`                                                      | `#161618` / `#ffffff`                                                                       | Panels                        |
| `--surface-raised`                                               | `#1c1c1f` / `#ffffff`                                                                       | Menus, dialogs, popovers      |
| `--surface-hover`                                                | `#232326` / `#efeff1`                                                                       | Hover and selected rows       |
| `--border` / `--border-strong`                                   | `#2a2a2e`, `#3a3a3f` / `#e4e4e7`, `#d0d0d6`                                                 | Hairlines                     |
| `--fg` / `--fg-muted` / `--fg-subtle`                            | `#ececef`, `#a3a3ab`, `#8a8a92` / `#18181b`, `#52525b`, `#6b6b74`                           | Text                          |
| `--accent` / `--accent-hover` / `--accent-fg` / `--accent-muted` | `#ff4f7b` (pinky-red, hover `#ff6b90`) / `#d6195a` (hover `#bf1650`), fg `#ffffff`          | Primary actions, active state |
| `--focus-ring`                                                   | `#ff4f7b` at 60% / `#d6195a` at 45%                                                         | `:focus-visible` ring         |
| `--danger` / `--danger-fg`                                       | `#ff6a4d` (coral) / `#c2410c`, both with fg `#ffffff`                                       | Destructive state             |
| `--success` / `--warning`                                        | `#3ecf8e` / `#15803d`, `#f5b83d` / `#b45309`                                                | Status                        |
| `--diff-add-bg` / `--diff-del-bg`                                | green at 12% / 12%, coral at 12% / 10%                                                      | Diff lines                    |
| `--overlay`                                                      | near-black 60% / slate 35%                                                                  | Modal backdrop                |
| `--selection`                                                    | `#ff4f7b` at 28% / `#d6195a` at 18%                                                         | Text selection                |
| `--scrollbar-thumb` / `-hover`                                   | `#2e2e33`, `#45454c` / `#d0d0d6`, `#b0b0b8`                                                 | Scrollbars                    |
| `--lane-0` .. `--lane-7`                                         | 8 harmonized graph lane colors (pinky-red, cyan, gold, purple, green, coral, teal, magenta) | Graph lane = `color % 8`      |

### Gradient

| Token                              | Use                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--gradient-chrome`                | Neutral surfaces with pinky-red glow. Utility `bg-chrome`. Chrome only.                                                                           |
| `--backdrop-1` / `-2` / `-3`       | Blob colors: accent pink-red, violet (lane 3), warm orange (lane 5). Dark `#ff4f7b`, `#a78bfa`, `#ff8a4c`; light `#d6195a`, `#7c3aed`, `#c2410c`. |
| `--backdrop-alpha-subtle`          | Peak opacity per blob behind the graph. Dark `0.035`, light `0.02`.                                                                               |
| `--backdrop-alpha-page`            | Peak opacity per blob on Home. Dark `0.12`, light `0.11`.                                                                                         |
| `--backdrop-blur-subtle` / `-page` | Blur radius, `56px` / `96px`.                                                                                                                     |

The alphas are valid only while the `backdrop` suite in `src/design/contrast.test.ts` passes: with all three blobs stacked at peak alpha, `subtle` over `--surface` keeps `--fg`, `--fg-muted`, `--fg-subtle`, `--accent` at 4.5:1 or more and every lane at 3:1 or more; `page` over `--bg` keeps `--fg` and `--fg-muted` at 4.5:1 or more.

### Shell (tab strip, toolbar, panels, staged/unstaged, terminal, avatar)

| Token                                                   | Dark / Light                                        | Use                                |
| ------------------------------------------------------- | --------------------------------------------------- | ---------------------------------- |
| `--tabbar-bg`                                           | `#09090a` / `#e9e9ec`                               | Tab strip background               |
| `--toolbar-bg`                                          | `#19191b` / `#fafafa`                               | Toolbar and active tab background  |
| `--tab-active-bg`                                       | `var(--toolbar-bg)` (both themes)                   | Active tab background              |
| `--tab-hover-bg`                                        | `#141416` / `#f1f1f3`                               | Tab hover state                    |
| `--panel-header-bg`                                     | `var(--bg-subtle)` (both themes)                    | Right panel header                 |
| `--lane-fg`                                             | `#111113` / `#ffffff`                               | Text/initials on lane-colored fill |
| `--avatar-ring`                                         | `var(--surface)` (both themes)                      | Avatar ring separator              |
| `--staged-accent` / `--staged-bg`                       | `var(--success)` / success at 6%                    | Staged file indicators             |
| `--unstaged-accent` / `--unstaged-bg`                   | `var(--warning)` / transparent                      | Unstaged file indicators           |
| `--terminal-bg` / `--terminal-fg` / `--terminal-cursor` | `#0e0e10` / `#ffffff`, `var(--fg)`, `var(--accent)` | Terminal emulator                  |
| `--terminal-selection`                                  | `#ff4f7b` at 30% / `#d6195a` at 20%                 | Terminal text selection            |

### Typography

`--font-sans` (Inter Variable), `--font-mono` (JetBrains Mono Variable). Sizes: `--text-xs` 11px, `--text-sm` 12px, `--text-base` 13px, `--text-lg` 15px, `--text-xl` 18px, `--text-2xl` 24px.

### Spacing, controls, radius

| Token                | Value                   |
| -------------------- | ----------------------- |
| `--space-1..8`       | 4, 8, 12, 16, 24, 32 px |
| `--control-sm/md/lg` | 24, 28, 32 px           |
| `--radius-sm/md/lg`  | 4, 6, 10 px             |

### Elevation, motion, z-index

| Token                                                          | Value                                       |
| -------------------------------------------------------------- | ------------------------------------------- |
| `--shadow-sm/md/lg`                                            | Subtle to prominent; lighter in light theme |
| `--duration-fast/base`                                         | 120ms / 180ms (0.01ms with reduced motion)  |
| `--ease-standard`                                              | `cubic-bezier(0.2, 0, 0, 1)`                |
| `--z-base/sticky/dropdown/overlay/modal/popover/toast/tooltip` | 0, 10, 50, 100, 110, 120, 130, 140          |

## Components

All exported from `src/design/components/index.ts`.

**Button**: variants `primary | secondary | ghost | danger | outline`, sizes `sm | md | icon`, `loading`, `asChild`.

```tsx
<Button variant="primary" loading={saving} onClick={save}>
  Save
</Button>
```

Button sizes: `xs` (20px), `sm` (24px), `md` (28px, default).

**IconButton**: ghost icon button; `aria-label` is required by type. `size`: `xs` 20px, `sm` 24px, `md` 28px (default).

```tsx
<IconButton aria-label="Refresh" size="sm" onClick={refetch}>
  <RefreshCw />
</IconButton>
```

**Checkbox**: native input, styled. `checked` is `boolean | "indeterminate"` (mixed shows a dash, `aria-checked="mixed"`); `onCheckedChange(boolean)`; optional `label` (wraps input so label click toggles). Without `label`, pass `aria-label`. 14px box, `--focus-ring`, accent fill.

```tsx
<Checkbox label="Stage all" checked={all} onCheckedChange={setAll} />
```

**SegmentedControl**: `role="radiogroup"` of buttons (`aria-checked`), roving tabindex; Arrow keys/Home/End move and select, skipping disabled options. `size`: `sm` | `md`. Icon-only options need `aria-label`.

```tsx
<SegmentedControl
  aria-label="View"
  value={view}
  onValueChange={setView}
  options={[
    { value: "list", label: "List", icon: <List /> },
    { value: "tree", label: "Tree", icon: <GitBranch /> },
  ]}
/>
```

**Input / Textarea / Label**: `aria-invalid="true"` shows the danger border.

```tsx
<Label htmlFor="b">Branch</Label>
<Input id="b" placeholder="feature/x" />
```

**Kbd**: `<Kbd>Ctrl</Kbd>`. **Spinner**: `<Spinner />` (role status). **Badge**: `neutral | accent | success | warning | danger`.

```tsx
<Badge variant="success">merged</Badge>
```

**Avatar**: round disc with an optional image (from `src` data: URL) or uppercase initials fallback. Props: `name` (required, display name and accessible title), `src` (optional image URL, shows initials on error), `size` (default 20px), `color` (fallback disc and ring color, default `var(--accent)`, use `laneVar(n)` for lane colors), `ring` (optional 2px border in `color` separated by `--avatar-ring`). Fallback text is on `--lane-fg` with size ~42% of the avatar `size`, semibold. Calling `initials(name)` directly: returns up to two uppercase letters (first letters of the first two words, or first two chars of the email local part, or `"?"`).

```tsx
<Avatar name="Ada Lovelace" size={32} />
<Avatar name="r4ph3rd" size={32} ring color="var(--lane-1)" />
<Avatar name="Ada Lovelace" size={32} src="data:image/..." />
```

**Tooltip**: works without a provider (mounts its own when none is above). Wrap the app in `TooltipProvider` to share delay settings across tooltips. Optional shortcut hint.

```tsx
<Tooltip content="Fetch" shortcut="Ctrl+F">
  <IconButton aria-label="Fetch">...</IconButton>
</Tooltip>
```

**Dialog**: `Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose`.

```tsx
<Dialog>
  <DialogTrigger asChild>
    <Button>New</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>New branch</DialogTitle>
    </DialogHeader>
    ...
  </DialogContent>
</Dialog>
```

**AlertDialog**: destructive confirms. Props: `title`, `description`, `preview`, `confirmLabel`, `cancelLabel`, `destructive`, `onConfirm`, `onCancel`, `open/onOpenChange` or `trigger`.

```tsx
<AlertDialog
  open={open}
  onOpenChange={setOpen}
  title="Delete branch?"
  description="Cannot be undone."
  preview={<code>feature/x</code>}
  confirmLabel="Delete"
  onConfirm={del}
/>
```

**DropdownMenu / ContextMenu**: `*Trigger, *Content, *Item (icon, shortcut, destructive), *Label, *Separator`.

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button>Actions</Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem icon={<Copy />} shortcut="Ctrl+C">
      Copy
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

**Popover**: `Popover, PopoverTrigger, PopoverContent, PopoverClose`.

**Tabs**: `Tabs, TabsList, TabsTrigger, TabsContent` (Radix props: `defaultValue`, `value`, `onValueChange`).

**Switch**: `<Switch checked={on} onCheckedChange={setOn} aria-label="Auto fetch" />`.

**Separator**: `<Separator />`, `orientation="vertical"`. **ScrollArea**: give it a fixed height.

**Toaster / toast**: mount `<Toaster />` once inside `ThemeProvider`; call `toast.success("Saved")`.

**ResizablePanels**: 1px handle with a wider hit area.

```tsx
<ResizablePanelGroup orientation="horizontal">
  <ResizablePanel defaultSize={30}>...</ResizablePanel>
  <ResizableHandle aria-label="Resize sidebar" />
  <ResizablePanel>...</ResizablePanel>
</ResizablePanelGroup>
```

**CommandPalette**: cmdk in a Dialog. Fuzzy filtering, arrow keys, Enter runs the item and closes.

```tsx
<CommandPalette
  open={open}
  onOpenChange={setOpen}
  groups={[
    {
      heading: "Git",
      items: [
        { id: "fetch", label: "Fetch", icon: <RefreshCw />, shortcut: "Ctrl+F", onSelect: fetch },
      ],
    },
  ]}
/>
```

**MeshBackdrop**: decorative wavy, blurred blobs (organic Catmull-Rom shapes from `src/design/mesh.ts`) in the `--backdrop-*` colors.

```tsx
<div className="relative isolate">
  {backdrop && <MeshBackdrop intensity="subtle" scrollRef={listRef} scrollKey={generation} />}
  {/* content */}
</div>
```

Props: `intensity` (`subtle` behind the graph, `page` on Home), `scrollRef` and `scrollKey` (optional scroll container for parallax), `className`. Place it as the first child of a `relative isolate` container. It is `aria-hidden`, `pointer-events-none`, never focusable, and does nothing while idle. On scroll the blobs translate mostly on X and a little on Y; transforms are written straight to the DOM through `requestAnimationFrame` (no React re-render per scroll). Under `prefers-reduced-motion` (`usePrefersReducedMotion`) it stays static. Consumers render it only when `AppSettings.backdrop` is true (Settings switch).

**EmptyState**: gradient chrome background.

```tsx
<EmptyState
  icon={<Inbox />}
  title="No repository"
  description="Open one."
  action={<Button variant="primary">Open</Button>}
/>
```

## Mobile

Touch-first primitives for the Android app (`docs/MOBILE_DESIGN.md`). Desktop rendering is unchanged: existing components only gain appended `coarse:` classes and `isCompact`/`isCoarse` branches.

### Rules

- **Layout** (compact vs regular) comes from the viewport via `useLayout()` (`@/app/layout/useLayout`). **Capabilities** (folder picker, SSH, worktrees, git CLI) come from `usePlatform()` (`@/app/platform`). Never infer one from the other: an Android tablet is regular layout with mobile capabilities.
- Never branch structure with CSS `hidden`/`compact:hidden` (both trees would mount, duplicate ids and focus targets). Branch in JSX on `useLayout()`; use `compact:`/`coarse:`/`short:` classes only to tune sizing.
- `coarse:` follows `(pointer: coarse)`, `compact:` follows the layout query, `short:` is landscape phones (height under 480px). The variants live in `src/index.css`; the query strings are shared with `useLayout` (asserted by a test).
- Targets are at least `--touch-target` (44px) on coarse pointers, list rows at least `--touch-target-row` (52px, `min-h`, never fixed `h`). Small visuals keep their size and grow their hit area (`::after` on `Switch`, padded wrapper on `Checkbox`).
- Every gesture has a visible or focusable alternative (swipe actions are real buttons, long-press has an overflow button).

### Tokens

| Token                                      | Value                                                             |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `--touch-target` / `--touch-target-row`    | 44px / 52px                                                       |
| `--appbar-h` / `--appbar-h-short`          | 48px / 40px (landscape)                                           |
| `--bottomnav-h` / `--navrail-w`            | 56px / 72px                                                       |
| `--sheet-radius`                           | `--radius-lg`                                                     |
| `--sheet-handle` / `--sheet-handle-h`      | 32px / 4px                                                        |
| `--sheet-max-h`                            | `85dvh` (snap `auto`)                                             |
| `--sheet-duration` / `--swipe-duration`    | `--duration-base` (180ms) / 150ms (both 1ms with reduced motion)  |
| `--progress-h`                             | 2px (AppBar progress line)                                        |
| `--safe-top/bottom/left/right`             | `env(safe-area-inset-*)`                                          |
| `--kb-inset`                               | Soft keyboard height, written by `useKeyboardInset()`             |
| keyframes `ds-sheet-in/out/progress-slide` | Sheet enter/exit (translateY) and the indeterminate progress line |

`ThemeProvider` keeps `<meta name="theme-color">` equal to the computed `--bg` whenever the resolved theme changes (the tag is created if missing), so Android system bars follow the theme.

### Existing components, touch variants

| Component           | Change on `coarse:`                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `Button`            | `min-h-[var(--touch-target)]`                                                                  |
| `IconButton`        | `min-h` and `min-w` `--touch-target`                                                           |
| `Checkbox`          | Wrapper `min-h`/`min-w` `--touch-target`; clicks on the padding forward to the 14px box        |
| `Switch`            | 44px `::after` hit area, visual size unchanged                                                 |
| `SegmentedControl`  | Options `min-h-[var(--touch-target)]`                                                          |
| `Input`, `Textarea` | `text-[16px]` (avoids Android zoom); `Input` also `min-h-[var(--touch-target)]`                |
| `Tooltip`           | Renders only its trigger when `useLayout().isCoarse` (keep an `aria-label`)                    |
| `Toaster`           | On compact, `offset`/`mobileOffset` = `calc(var(--bottomnav-h) + var(--safe-bottom))`          |
| `CommandPalette`    | On compact renders in a full `Sheet` (input on top); `Kbd` hidden when coarse; props unchanged |

### Components

All exported from `@/design/components`.

**Sheet**: bottom sheet on `@radix-ui/react-dialog` (`Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`). Controlled or uncontrolled; while open it registers on the Android back stack, so back closes it. `SheetContent` props: `snap` `"auto"` (content height, max `--sheet-max-h`, default) or `"full"` (100dvh minus `--safe-top`), `dragToDismiss` (default true; drag the handle past 30% of the height or faster than 0.5 px/ms), `hideHandle`. The body scrolls; `SheetFooter` sticks to the bottom and pads `--safe-bottom`. A title is required (`sr-only` is fine). Uses `bg-surface-raised`, `--border`, `--shadow-lg`, `--overlay`, `--sheet-radius`, `--sheet-duration`.

```tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent snap="auto">
    <SheetHeader>
      <SheetTitle>Branch</SheetTitle>
      <SheetDescription>Pick an action</SheetDescription>
    </SheetHeader>
    <SheetFooter>
      <Button variant="primary">Done</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

**ActionSheet**: `{ open, onOpenChange, title, description?, items, groups?, cancelLabel? }`. Rows are `--touch-target-row` high; `destructive` rows use `--danger`; `groups` renders separators between arrays. Selecting a row closes the sheet, then calls `onSelect`. Items: `{ id, label, icon?, description?, destructive?, disabled?, onSelect }`.

**ResponsiveDialog**: same API as `Dialog` (`ResponsiveDialogTrigger/Close/Content/Header/Footer/Title/Description`). On regular it renders exactly the `Dialog*` DOM and classes; on compact a `Sheet` (`snap="full"` unless overridden, no close button). Both register on the back stack. Swap `Dialog` for it in features gradually.

**AppBar**: `{ title, subtitle?, onTitleClick?, onBack?, backLabel?, leading?, actions?, progress?, children? }`. Height `--appbar-h` (`--appbar-h-short` on `short:`) plus `--safe-top`, `bg-chrome`, bottom border. `onBack` shows a 44px `IconButton` (`aria-label` "Back" by default); `onTitleClick` renders the title as a button (repo switcher). `progress` is `0..1` or `"indeterminate"`: a 2px accent line (`role="progressbar"`). `children` render under the bar row.

**BottomNav / NavRail**: `{ items: { id, label, icon, badge? }[], activeId, onSelect, hidden? }`. `<nav aria-label="Primary">` with `aria-current="page"` on the active button; `onSelect` also fires when re-tapping the active item; `badge` is a count or a dot. `BottomNav` height `--bottomnav-h` plus `--safe-bottom`; `NavRail` is vertical, `--navrail-w` plus `--safe-left`, for landscape. `hidden` renders nothing (for example while the keyboard is open).

**SwipeRow**: `{ leftAction?, rightAction?, disabled?, className?, children }` with `SwipeAction = { label, icon?, tone: "success" | "danger" | "neutral", onTrigger }`. Swipe right reveals `leftAction`, swipe left reveals `rightAction`. Commits at 40% of the width or 0.5 px/ms, otherwise springs back over `--swipe-duration`; `touch-action: pan-y`. Each action is also a real `<button>` (visually hidden until focused). Always pair with a checkbox or overflow button.

**PullToRefresh**: `{ onRefresh: () => Promise<unknown>, getScrollElement?, disabled?, label?, className?, children }`. Pulling more than 64px at `scrollTop` 0 calls `onRefresh`; shows a `Spinner` and a `role="status"` text while pending; sets `overscroll-behavior-y: contain` on the scroller. While the scroller is at the top the wrapper uses `touch-action: pan-x pan-up` so downward pans reach the component. A custom scroller must be the wrapper or inside it.

**ListRow**: `{ title, subtitle?, leading?, trailing?, chevron?, selected?, disabled?, onClick? }`. `<button>` when `onClick` is set, else `<div>`. `min-h-[var(--touch-target-row)]`, 120ms press state (`--surface-hover`), truncating text.

### Hooks

Import from `@/design/hooks`.

- `useLongPress(onLongPress, { delay = 450, slop = 8, disabled, vibrate = true })` returns handlers to spread on the target (`onPointerDown/Move/Up/Cancel/Leave`, `onContextMenu`). Cancels on movement over `slop` or on scroll, calls `navigator.vibrate(10)` when available, suppresses the native context menu.
- `useKeyboardInset()` returns the soft keyboard height from `VisualViewport` (0 without it) and writes `--kb-inset` on `<html>`.

## Settings screen

`src/features/settings/` builds the dialog from existing components only (Dialog, SegmentedControl, Switch, Input, Button, Kbd, Label); no new tokens. Open it with `mod+,`, the "Settings" command or `openSettings(section?)`. Mount `<SettingsHost />` once inside `ThemeProvider`, `QueryClientProvider` and beside `CommandHost`.

- Sections (left nav): General (theme, confirm destructive), Git (executable path with Browse, pull strategy, graph order, diff context 0..20), Keyboard (recorder), AI (only when a command `ai.settings` is registered), About.
- Keyboard recorder: Record captures the next chord (Escape cancels, announced through a live region), Clear unbinds, Reset restores the default, conflicts are flagged with `findConflicts` and need "Assign anyway". Overrides persist through `keybindingsSet` and apply live via `setShortcutOverrides` in `src/app/commands`.
- State: `src/stores/settings.ts`. `useSettings()` for components; `getConfirmDestructive()`, `getPullStrategy()`, `getDiffContextLines()`, `getGraphOrder()` for commands and handlers; `updateSettings(patch)` is optimistic and rolls back with an error toast.
