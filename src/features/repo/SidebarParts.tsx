import { useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  dndStateClass,
  useDndNode,
  type DndNodeConfig,
} from "@/features/operations/dnd/useDndNode";
import { cn } from "@/lib/cn";

export function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1 px-2 text-xs font-medium uppercase tracking-wide text-fg-subtle hover:text-fg-muted"
      >
        <Chevron className="size-3" aria-hidden />
        {title}
        <span className="ml-auto font-mono">{count}</span>
      </button>
      {open && <ul>{children}</ul>}
    </section>
  );
}

export function Item({
  label,
  active,
  hint,
  badges,
  nested,
  onClick,
  dnd,
  ref: outerRef,
  onPointerDown,
  onKeyDown,
  ...rest
}: {
  label: string;
  active?: boolean;
  hint?: string;
  /** Small status badges shown before the hint (submodule status, worktree flags). */
  badges?: ReactNode;
  /** Indent one level (remote branches under their remote). */
  nested?: boolean;
  onClick?: () => void;
  /** Makes the item draggable and/or a drop target (branches and tags). */
  dnd?: DndNodeConfig;
} & Omit<ComponentProps<"button">, "children" | "className" | "type">) {
  const { setNodeRef, dragProps, state: dndState, isDragging } = useDndNode(dnd);
  const drag = dragProps;
  return (
    <li>
      <button
        {...rest}
        {...dragProps}
        ref={(el) => {
          setNodeRef(el);
          if (typeof outerRef === "function") outerRef(el);
          else if (outerRef) outerRef.current = el;
        }}
        // The context-menu trigger and the drag sensors both listen to these; run both.
        onPointerDown={(e) => {
          onPointerDown?.(e);
          drag.onPointerDown?.(e);
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          drag.onKeyDown?.(e);
        }}
        type="button"
        onClick={onClick}
        className={cn(
          "flex h-6 w-full items-center gap-2 truncate pr-2 text-left text-sm hover:bg-surface-hover",
          nested ? "pl-10" : "pl-6",
          active ? "font-semibold text-accent" : "text-fg",
          dndState && dndStateClass[dndState],
          isDragging && "opacity-50",
        )}
      >
        <span className="truncate">{label}</span>
        {badges && <span className="ml-auto flex shrink-0 items-center gap-1">{badges}</span>}
        {hint && (
          <span className={cn("shrink-0 font-mono text-xs text-fg-subtle", !badges && "ml-auto")}>
            {hint}
          </span>
        )}
      </button>
    </li>
  );
}
