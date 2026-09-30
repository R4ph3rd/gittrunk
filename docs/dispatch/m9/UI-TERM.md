# UI-TERM: xterm terminal in the bottom panel

- Wave: 1
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/terminal-ui`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.2 (Terminal); merged contracts: `src/ipc/bindings.ts` (`terminalOpen`, `terminalWrite`, `terminalResize`, `terminalClose`, `events.terminalOutput`, `events.terminalExit`), `src/app/testing.tsx` (`emitTerminalOutput`, `emitTerminalExit`), stub `src/features/terminal/TerminalPanel.tsx`, `src/stores/{repo,layout}.ts`, `src/features/graph/colors.ts` (`onThemeChange`, reading CSS variables), tokens `--terminal-*`; `@xterm/xterm` 6 and `@xterm/addon-fit` 0.11 docs.
- Frontend only.

## Goal

A real terminal (the backend PTY) in the bottom panel, opened in the repository root, themed from tokens, resized with the panel, and kept alive while its repository tab is open even when the panel is hidden.

## Owned files

`src/features/terminal/**` (replace the stub body; keep `export function TerminalPanel({ repoId, cwd }: { repoId: string; cwd: string })`), new `src/features/terminal/{sessions.ts,theme.ts,terminal.test.tsx}`.
Must NOT touch anything else. UI-SHELL mounts `TerminalPanel` (lazily) in the bottom panel.

## Behavior

- `sessions.ts`: a module-level registry `repoId -> Session { id | null, term: Terminal, fit: FitAddon, host: HTMLDivElement, exited: boolean }`. `TerminalPanel` mounts by appending the session's `host` div into its container (xterm's `open()` is called once per session on that host), so unmounting and remounting re-attaches the same terminal with its scrollback; unmount never kills the process.
- One global subscription to `events.terminalOutput` / `events.terminalExit` (installed on first use) routes by id: output -> `term.write(data)`; exit -> write `\r\n[process exited with code N; press Enter to restart]\r\n` in `--fg-subtle` color, mark exited; Enter in that state opens a new backend session.
- Opening: after the first fit, `terminalOpen({ cwd, cols, rows })`; `term.onData` -> `terminalWrite(id, data)` (ignored while exited except Enter); container resize (ResizeObserver, debounced 50 ms) -> `fit.fit()` -> `terminalResize(id, cols, rows)` when changed.
- Disposal: subscribe to `useRepoStore`; when a repo disappears from `repos`, `terminalClose(id)` and `term.dispose()`, remove from the registry.
- Header (28px, `bg-panel-header`): "Terminal" + repo name, `IconButton`s "Restart terminal" (`RotateCw`: close then open), "Kill terminal" (`Trash2`), "Hide panel" (`X`: `useLayoutStore.getState().setVisible("bottom", false)`).
- Theme (`theme.ts`): `background` `--terminal-bg`, `foreground` `--terminal-fg`, `cursor` `--terminal-cursor`, `selectionBackground` `--terminal-selection`, read with `getComputedStyle`; updated on theme change. Font `--font-mono`, 12px. ANSI colors stay xterm defaults. Import `@xterm/xterm/css/xterm.css` here.
- Errors from `terminalOpen` (e.g. `unsupported`, bad cwd) render inline in the panel with a Retry button. When `!usePlatform().supportsTerminal`, render an explanatory `EmptyState` and never call the backend.
- Focus: clicking the panel focuses xterm; `Escape` stays with the terminal (do not close panels from inside it).

## Tests

`terminal.test.tsx` with `vi.mock("@xterm/xterm")` / `vi.mock("@xterm/addon-fit")` fakes recording `open`, `write`, `onData`, `options`, `dispose`, and `vi.mock` of the CSS import if needed: mount -> `terminalOpen` with the cwd and fitted size; `emitTerminalOutput("term-1", "hi")` -> fake `write("hi")`; typed data -> `terminalWrite`; unmount + remount -> no second `terminalOpen`, same host element re-attached; exit event -> message, then Enter -> new `terminalOpen`; removing the repo from the store -> `terminalClose` + `dispose`; Restart and Kill buttons; unsupported platform -> no backend call; theme values come from CSS variables.

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm vite build   # xterm lands in the vendor-xterm chunk, not the main chunk
```

## Acceptance criteria

- Tests green; xterm is not in the entry chunk (UI-SHELL lazy-loads the panel; verify with the build output).
- No raw colors; buttons labelled.

## Commits

`feat(terminal): xterm terminal panel backed by the PTY commands`, `feat(terminal): keep sessions alive per repository`.

## Out of scope / needs orchestrator

Multiple terminals, split panes, search, links, shell selection UI.
