import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Plain accessible select styled with tokens, until the design system ships a Select. */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-[var(--control-md)] w-full rounded-md border border-border bg-bg-subtle px-2 text-base text-fg hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
        className,
      )}
      {...props}
    />
  );
}
