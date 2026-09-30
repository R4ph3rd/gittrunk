import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Empty states are one of the two places gradients are allowed (with app chrome). */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-chrome px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 flex size-8 items-center justify-center rounded-md border border-border bg-surface text-fg-muted [&_svg]:size-4">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-semibold text-fg">{title}</h3>
      {description ? <p className="max-w-sm text-base text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
