import { Check, Minus } from "lucide-react";
import { forwardRef, useEffect, useRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { focusRing, transition } from "./shared";

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "checked" | "onChange" | "size"
> {
  /** `"indeterminate"` renders a dash and sets aria-checked="mixed". */
  checked?: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean) => void;
  /** Optional visible label, associated with the input. */
  label?: string;
}

/** Native checkbox, visually styled. Space toggles; label click toggles. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, label, disabled, ...props }, ref) => {
    const inner = useRef<HTMLInputElement | null>(null);
    const indeterminate = checked === "indeterminate";
    useEffect(() => {
      if (inner.current) inner.current.indeterminate = indeterminate;
    }, [indeterminate]);

    const box = (
      <span className={cn("relative inline-flex size-3.5 shrink-0", !label && className)}>
        <input
          ref={(el) => {
            inner.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) ref.current = el;
          }}
          type="checkbox"
          disabled={disabled}
          checked={indeterminate ? false : checked}
          aria-checked={indeterminate ? "mixed" : undefined}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          className={cn(
            "peer size-3.5 shrink-0 cursor-pointer appearance-none rounded-sm border border-border-strong bg-surface checked:border-transparent checked:bg-accent indeterminate:border-transparent indeterminate:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
            focusRing,
            transition,
          )}
          {...props}
        />
        <Check
          aria-hidden
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-2.5 text-accent-fg opacity-0 peer-checked:opacity-100"
        />
        {indeterminate ? (
          <Minus
            aria-hidden
            strokeWidth={3}
            className="pointer-events-none absolute inset-0 m-auto size-2.5 text-accent-fg"
          />
        ) : null}
      </span>
    );
    if (!label) return box;
    return (
      <label
        className={cn(
          "inline-flex items-center gap-2 text-base text-fg",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        {box}
        <span>{label}</span>
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
