# Design system

Status: token skeleton (M0). The full component set and `/design` route arrive in M1 (design-system-agent).

## Principles

- Dark-first, with a light theme. References: Clerk, Linear, Vercel.
- Tight spacing, crisp 1px borders, subtle shadows, restrained motion.
- Gradients on app chrome and empty states only; content surfaces stay flat.
- Every value is a token. Components never use raw colors.

## Where tokens live

- `src/design/tokens.css`: CSS variables. Dark values on `:root`, light values on `[data-theme="light"]`.
- `src/index.css`: `@theme inline` maps tokens to Tailwind utilities (Tailwind v4 CSS-first config).

## Tokens

| Group       | Variables                                                                         | Tailwind                                     |
| ----------- | --------------------------------------------------------------------------------- | -------------------------------------------- |
| Surfaces    | `--bg`, `--bg-subtle`, `--surface`, `--surface-raised`, `--surface-hover`         | `bg-bg`, `bg-surface`, …                     |
| Borders     | `--border`, `--border-strong`                                                     | `border-border`, `border-border-strong`      |
| Text        | `--fg`, `--fg-muted`, `--fg-subtle`                                               | `text-fg`, `text-fg-muted`, `text-fg-subtle` |
| Accent      | `--accent`, `--accent-fg`, `--accent-muted`, `--focus-ring`                       | `bg-accent`, `text-accent`, …                |
| Status      | `--danger`, `--success`, `--warning`                                              | `text-danger`, …                             |
| Diff        | `--diff-add-bg`, `--diff-del-bg`                                                  | via `var()`                                  |
| Graph lanes | `--lane-0` … `--lane-7`                                                           | via `var()` (canvas)                         |
| Type        | `--font-sans` (Inter), `--font-mono` (JetBrains Mono), `--text-xs` … `--text-2xl` | `font-sans`, `font-mono`, `text-sm`, …       |
| Spacing     | `--space-1` … `--space-8` (4px scale)                                             | Tailwind spacing scale                       |
| Radius      | `--radius-sm` 4px, `--radius-md` 6px, `--radius-lg` 10px                          | `rounded-sm/md/lg`                           |
| Elevation   | `--shadow-sm`, `--shadow-md`, `--shadow-lg`                                       | `shadow-sm/md/lg`                            |
| Motion      | `--duration-fast` 120ms, `--duration-base` 180ms, `--ease-standard`               | `ease-standard`                              |
| Chrome      | `--gradient-chrome`                                                               | `bg-chrome`                                  |

### Chrome gradient

Deep indigo (`#3730a3` at 35%) from the top-left, teal (`#0b3b3c` at 55%) rising from the bottom, and a faint warm amber glow (`#fbbf24` at 8%) at the top-right, over a near-black base. The light theme uses the same composition at lower intensity.
