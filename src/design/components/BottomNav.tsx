import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { focusRing, transition } from "./shared";

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: number | boolean;
}

export interface BottomNavProps {
  items: NavItem[];
  activeId: string;
  /** Also fired when re-tapping the active item. */
  onSelect: (id: string) => void;
  /** e.g. while the keyboard is open. */
  hidden?: boolean;
}

function Badge({ badge }: { badge: NavItem["badge"] }) {
  if (!badge) return null;
  if (badge === true) {
    return (
      <span
        aria-hidden
        className="absolute -right-1 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-[color:var(--surface)]"
      />
    );
  }
  return (
    <span className="absolute -right-2.5 -top-1 min-w-4 rounded-full bg-accent px-1 text-center text-xs font-medium leading-4 text-accent-fg">
      {badge > 99 ? "99+" : badge}
    </span>
  );
}

function NavButton({
  item,
  active,
  onSelect,
  vertical,
}: {
  item: NavItem;
  active: boolean;
  onSelect: (id: string) => void;
  vertical?: boolean;
}) {
  const count = typeof item.badge === "number" && item.badge > 0 ? item.badge : null;
  return (
    <li className={cn(vertical ? "w-full" : "flex-1")}>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        aria-label={count ? `${item.label}, ${count}` : item.label}
        onClick={() => onSelect(item.id)}
        className={cn(
          "flex min-h-[var(--touch-target)] w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-xs font-medium [&_svg]:size-5 [&_svg]:shrink-0",
          vertical ? "h-14" : "h-full",
          active ? "text-accent" : "text-fg-muted active:bg-surface-hover",
          focusRing,
          transition,
        )}
      >
        <span className="relative flex">
          {item.icon}
          <Badge badge={item.badge} />
        </span>
        <span className="max-w-full truncate">{item.label}</span>
      </button>
    </li>
  );
}

/** Primary navigation at the bottom of compact portrait layouts. */
export function BottomNav({ items, activeId, onSelect, hidden }: BottomNavProps) {
  if (hidden) return null;
  return (
    <nav
      aria-label="Primary"
      className="shrink-0 border-t border-border bg-surface pb-[var(--safe-bottom)] pl-[var(--safe-left)] pr-[var(--safe-right)]"
    >
      <ul className="m-0 flex h-[var(--bottomnav-h)] list-none items-stretch p-0">
        {items.map((item) => (
          <NavButton key={item.id} item={item} active={item.id === activeId} onSelect={onSelect} />
        ))}
      </ul>
    </nav>
  );
}

/** Vertical variant of `BottomNav` for landscape (`short`) layouts. */
export function NavRail({ items, activeId, onSelect, hidden }: BottomNavProps) {
  if (hidden) return null;
  return (
    <nav
      aria-label="Primary"
      className="flex w-[calc(var(--navrail-w)+var(--safe-left))] shrink-0 flex-col border-r border-border bg-surface pl-[var(--safe-left)]"
    >
      <ul className="m-0 flex list-none flex-col items-stretch gap-1 overflow-y-auto p-1">
        {items.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={item.id === activeId}
            onSelect={onSelect}
            vertical
          />
        ))}
      </ul>
    </nav>
  );
}
