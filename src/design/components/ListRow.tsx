import { ChevronRight } from "lucide-react";
import { forwardRef, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/cn";
import { focusRing, transition } from "./shared";

export interface ListRowProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "onClick"> {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** Renders a `<button>` when set, otherwise a `<div>`. */
  onClick?: () => void;
}

/** Touch list row: min `--touch-target-row` high (grows with font scale), truncating text. */
export const ListRow = forwardRef<HTMLElement, ListRowProps>(
  (
    {
      title,
      subtitle,
      leading,
      trailing,
      chevron,
      selected,
      disabled,
      onClick,
      className,
      ...rest
    },
    ref,
  ) => {
    const classes = cn(
      "flex min-h-[var(--touch-target-row)] w-full items-center gap-3 px-3 py-2 text-left text-base text-fg",
      selected && "bg-accent-muted",
      onClick && "cursor-pointer hover:bg-surface-hover active:bg-surface-hover",
      disabled && "pointer-events-none opacity-50",
      focusRing,
      transition,
      className,
    );
    const body = (
      <>
        {leading ? (
          <span className="flex shrink-0 items-center text-fg-muted">{leading}</span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{title}</span>
          {subtitle ? <span className="truncate text-sm text-fg-muted">{subtitle}</span> : null}
        </span>
        {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
        {chevron ? <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" /> : null}
      </>
    );
    if (onClick) {
      return (
        <button
          ref={ref as Ref<HTMLButtonElement>}
          type="button"
          disabled={disabled}
          aria-current={selected ? "true" : undefined}
          onClick={onClick}
          className={classes}
          {...(rest as HTMLAttributes<HTMLButtonElement>)}
        >
          {body}
        </button>
      );
    }
    return (
      <div
        ref={ref as Ref<HTMLDivElement>}
        aria-disabled={disabled || undefined}
        className={classes}
        {...(rest as HTMLAttributes<HTMLDivElement>)}
      >
        {body}
      </div>
    );
  },
);
ListRow.displayName = "ListRow";
