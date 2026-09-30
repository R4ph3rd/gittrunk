# M9 dispatch: common rules for every builder

Read `docs/dispatch/android/COMMON.md` first: its sections "Where you are", "Environment facts", "Git and commits", "Quality gates" and "Report back" apply unchanged (worktree per package, shared `CARGO_TARGET_DIR` exports, no `cargo clean`, frontend builders never run cargo or `pnpm bindings`, commit trailers, exit-code checks). This file adds the M9 rules. Your brief wins where it is more specific.

## Plan and contracts

- The plan is `docs/PLAN.md` §12. Contract shapes are in `docs/dispatch/m9/C0.md` (IPC, hooks, stores, stubs) and `docs/dispatch/m9/P0.md` (tokens, `Avatar`). After Wave 0 they are merged: read the real files (`src-tauri/src/ipc/types.rs`, `src/ipc/bindings.ts`, `src/ipc/queries.ts`, `src/stores/{layout,workspace,nav}.ts`, `src/design/tokens.css`, `src/design/components/Avatar.tsx`) rather than the briefs when they differ, and report the difference.
- Only C0 adds dependencies or changes `src-tauri/src/ipc/**`, `src/ipc/bindings.ts`, `src/ipc/queries.ts`, `src/app/{mockBindings.ts,testing.tsx,platform.ts}`, `src-tauri/{Cargo.toml,Cargo.lock,tauri.conf.json}`, `src-tauri/src/{lib.rs,platform.rs,http.rs}`, `package.json`, `pnpm-lock.yaml`, `vite.config.ts`. Only P0 changes `src/design/tokens.css` and `src/index.css`. If you need a new hook, type, token or dependency, write it under "Needs orchestrator" and work around it locally (a private helper in your own files) when possible.
- Stub files created by C0 (`src/features/terminal/TerminalPanel.tsx`, `src/features/forge/{IssuesSection,ForgeMainView,CommitComments}.tsx`, `src/features/forge/mobile/contrib.ts`) keep their export names and props; the owning package replaces their bodies.

## Styling

- Colors only through tokens: Tailwind token utilities (`bg-surface`, `text-fg-muted`, `border-border`, `bg-toolbar`, ...) or `var(--token)` in inline styles. No raw hex/rgb/hsl outside `src/design/tokens.css`, no Tailwind palette classes (`zinc-*`, `red-*`, `white`, `black`, ...). Lane colors: `laneVar(color)` from `src/lib/laneColor.ts` (inline `style`), never dynamic class names.
- Canvas code reads colors from CSS variables at runtime (as `src/features/graph/colors.ts` does) and re-reads them on theme change.
- Icons: `lucide-react`. Icon-only buttons have `aria-label` and a `Tooltip` (with the shortcut when one exists); toggles use `aria-pressed`; everything is keyboard reachable with the token focus ring.

## Capabilities and layout

- `usePlatform()` flags: `readOnly` (Android: hide git write actions), `supportsTerminal` (hide the terminal toggle and panel). Layout still comes from `useLayout()`. An Android tablet is regular layout and read-only: desktop components you own must honor `readOnly` too.
- Tests mock Android with `commands.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM))` from `src/app/platform.ts`.

## Tests

- Vitest + Testing Library. Desktop tests run at the default jsdom viewport (the app treats it as regular layout); compact tests use `setViewport(390, 844)`. Reset state with `resetStore()` from `src/app/testing.tsx` (C0 makes it reset the layout and workspace stores too).
- The whole suite must pass in your worktree. Existing assertions may change only where your brief says the behavior intentionally changes. If your change breaks an assertion in a test file you do not own (for example a full-app test rendering `renderApp()`), adapt only that assertion, in a separate commit `test(<scope>): adapt <file> to <change>`, and list it in your report; the main session keeps both sides when merging.
- Primary owners of full-app tests: `src/app/App.test.tsx`, `src/app/commands.test.tsx` and `src/features/staging/staging.test.tsx` (UI-SHELL), `src/features/remotes/remotes.test.tsx` (UI-TOOLBAR), `src/features/operations/{operations.test.tsx,dnd/dnd.test.tsx}` and `src/features/graph/*.test.ts` (UI-GRAPH), `src/app/layout/shell.test.tsx` and `src/features/repo/mobile/mobile.test.tsx` (UI-MOBILE), `src/features/settings/settings.test.tsx` (UI-FORGE).
- New behavior gets new tests in new files named in your brief.

## e2e invariants (desktop, `e2e/specs/*.mjs`, run by CHECK)

Keep these working; the specs are not edited in Wave 1:

- The graph grid keeps `aria-label="Commit graph"` with `role="row"` rows; branch labels are `span[data-kind="localBranch"]` whose normalized text is exactly the branch name (icons are fine, extra text is not), and they stay draggable.
- The WIP row contains the text `// WIP`; clicking it shows an element with `aria-label="Working copy"` (the Changes tab of the right panel, visible by default).
- A button whose text is exactly `Stage all`; the commit summary input keeps `placeholder="Commit summary"`; a button with text `Commit`.
- Exactly one visible button without `aria-label` whose text contains `Push` (the toolbar's). No other toolbar text contains "Push".
- `Ctrl+Z` opens an `alertdialog` with a button `Undo`.
- `aria-label="Commit details"` on the commit details container; `data-testid="app-info"` in the status bar; the Welcome screen's `section[aria-label="Recent repositories"]`.

## Commit scopes

`feat(ipc)`, `feat(design)`, `feat(shell)`, `feat(toolbar)`, `feat(graph)`, `feat(staging)`, `feat(sidebar)`, `feat(terminal)`, `feat(forge)`, `feat(avatars)`, `feat(mobile)`, `fix(oplog)`, `feat(dev)`, `test(<scope>)`, `docs(<scope>)`. Trailers as in the Android COMMON.

## Report back

As in the Android COMMON, plus: the list of test files outside your ownership you adapted (file, assertion, reason), and screenshots or a short description of any visual change you could not verify (Wave 1 builders cannot run `/preview` until PV is merged; CHECK does the visual review).
