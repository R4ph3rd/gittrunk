/** Shared class strings built from design tokens (no raw colors). */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]";

export const transition = "transition-colors duration-[var(--duration-fast)] ease-standard";

export const popIn = "animate-[ds-pop-in_var(--duration-base)_var(--ease-standard)]";
export const fadeIn = "animate-[ds-fade-in_var(--duration-base)_var(--ease-standard)]";

/** Surface used by floating panels (menus, popovers, tooltips, dialogs). */
export const floating = "border border-border bg-surface-raised text-fg shadow-md rounded-md";

export const overlay = "fixed inset-0 z-[var(--z-overlay)] bg-[color:var(--overlay)]";

export const modal =
  "fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface-raised p-4 text-fg shadow-lg";

export const menuItem =
  "relative flex h-[var(--control-md)] cursor-default select-none items-center gap-2 rounded-sm px-2 text-base outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-muted";
