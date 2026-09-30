import { useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  nested,
  onClick,
  ...rest
}: {
  label: string;
  active?: boolean;
  hint?: string;
  /** Indent one level (remote branches under their remote). */
  nested?: boolean;
  onClick?: () => void;
} & Omit<ComponentProps<"button">, "children" | "className" | "type">) {
  return (
    <li>
      <button
        {...rest}
        type="button"
        onClick={onClick}
        className={cn(
          "flex h-6 w-full items-center gap-2 truncate pr-2 text-left text-sm hover:bg-surface-hover",
          nested ? "pl-10" : "pl-6",
          active ? "font-semibold text-accent" : "text-fg",
        )}
      >
        <span className="truncate">{label}</span>
        {hint && <span className="ml-auto shrink-0 font-mono text-xs text-fg-subtle">{hint}</span>}
      </button>
    </li>
  );
}
