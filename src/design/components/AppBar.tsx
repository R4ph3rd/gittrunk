import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { focusRing, transition } from "./shared";
import { IconButton } from "./IconButton";

export interface AppBarProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Renders the title as a button (repo switcher). */
  onTitleClick?: () => void;
  onBack?: () => void;
  /** Default aria-label "Back". */
  backLabel?: string;
  leading?: ReactNode;
  actions?: ReactNode;
  /** 2px accent line on the bottom edge. */
  progress?: number | "indeterminate" | null;
  className?: string;
  /** Rendered under the bar row (e.g. a search field). */
  children?: ReactNode;
}

function Progress({ value }: { value: number | "indeterminate" }) {
  const indeterminate = value === "indeterminate";
  const pct = indeterminate ? 0 : Math.min(100, Math.max(0, value * 100));
  return (
    <div
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      className="absolute inset-x-0 bottom-0 h-[var(--progress-h)] overflow-hidden"
    >
      {indeterminate ? (
        <div className="h-full w-2/5 animate-[ds-progress-slide_1.2s_var(--ease-standard)_infinite] bg-accent motion-reduce:animate-none" />
      ) : (
        <div
          className="h-full bg-accent transition-[width] duration-[var(--duration-base)] ease-standard"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}

/** Top bar: `--appbar-h` (`--appbar-h-short` in landscape) plus the top safe area. */
export function AppBar({
  title,
  subtitle,
  onTitleClick,
  onBack,
  backLabel = "Back",
  leading,
  actions,
  progress = null,
  className,
  children,
}: AppBarProps) {
  const heading = (
    <span className="flex min-w-0 flex-col text-left">
      <span className="truncate text-base font-semibold">{title}</span>
      {subtitle ? <span className="truncate text-xs text-fg-muted">{subtitle}</span> : null}
    </span>
  );
  return (
    <header
      className={cn(
        "relative shrink-0 border-b border-border bg-chrome pl-[var(--safe-left)] pr-[var(--safe-right)] pt-[var(--safe-top)] text-fg",
        className,
      )}
    >
      <div className="flex h-[var(--appbar-h)] items-center gap-1 px-2 short:h-[var(--appbar-h-short)]">
        {onBack ? (
          <IconButton aria-label={backLabel} size="md" onClick={onBack}>
            <ChevronLeft />
          </IconButton>
        ) : null}
        {leading}
        <div className="flex min-w-0 flex-1 items-center px-1">
          {onTitleClick ? (
            <button
              type="button"
              onClick={onTitleClick}
              className={cn(
                "flex min-h-[var(--touch-target)] min-w-0 items-center rounded-md px-1 hover:bg-surface-hover active:bg-surface-hover",
                focusRing,
                transition,
              )}
            >
              {heading}
            </button>
          ) : (
            heading
          )}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
      {progress !== null && progress !== undefined ? <Progress value={progress} /> : null}
    </header>
  );
}
