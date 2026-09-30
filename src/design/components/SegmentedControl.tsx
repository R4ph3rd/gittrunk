import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { focusRing, transition } from "./shared";

export interface SegmentedOption<T extends string = string> {
  value: T;
  label?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Required when the option has no text label. */
  "aria-label"?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: "sm" | "md";
  "aria-label"?: string;
  className?: string;
}

/** role="radiogroup" of buttons with roving tabindex and arrow-key navigation. */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onValueChange,
  size = "md",
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const pos = enabled.indexOf(index);
    let next: number | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(pos + 1) % enabled.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    refs.current[next]?.focus();
    const target = options[next];
    if (target) onValueChange(target.value);
  };

  const selectedIndex = options.findIndex((o) => o.value === value && !o.disabled);
  const tabStop = selectedIndex >= 0 ? selectedIndex : enabled[0];

  return (
    <div
      role="radiogroup"
      aria-label={rest["aria-label"]}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5",
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o["aria-label"]}
            disabled={o.disabled}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onValueChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-sm font-medium disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0 coarse:min-h-[var(--touch-target)]",
              size === "sm" ? "h-5 px-1.5 text-sm" : "h-6 px-2 text-base",
              active
                ? "bg-surface-raised text-fg shadow-sm"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg",
              focusRing,
              transition,
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
