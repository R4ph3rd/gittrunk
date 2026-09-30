import { useRef, type ReactNode } from "react";
import { EllipsisVertical } from "lucide-react";
import { IconButton, ListRow } from "@/design/components";
import { useLongPress } from "@/design/hooks";
import { cn } from "@/lib/cn";

/**
 * A 52px branch / tag row. Tap and long-press both open the ref action sheet, and the overflow
 * button is the visible alternative to long-press.
 */
export function RefRow({
  label,
  active,
  hint,
  subtitle,
  onOpen,
  actionsLabel,
  leading,
}: {
  label: string;
  /** The checked-out branch: accent dot and accent text. */
  active?: boolean;
  /** Ahead/behind counts. */
  hint?: ReactNode;
  subtitle?: ReactNode;
  onOpen: () => void;
  actionsLabel: string;
  leading?: ReactNode;
}) {
  const fired = useRef(false);
  const press = useLongPress(() => {
    fired.current = true;
    onOpen();
  });
  return (
    <div className="flex items-center pr-1">
      <ListRow
        {...press}
        onPointerDown={(e) => {
          fired.current = false;
          press.onPointerDown(e);
        }}
        className="min-h-[52px] flex-1"
        title={
          <span className={cn("font-mono text-sm", active && "font-semibold text-accent")}>
            {label}
          </span>
        }
        subtitle={subtitle}
        leading={
          leading ??
          (active ? (
            <span
              data-testid="current-branch-dot"
              aria-label="Current branch"
              className="size-2 rounded-full bg-accent"
            />
          ) : (
            <span className="size-2" />
          ))
        }
        trailing={hint ? <span className="font-mono text-xs text-fg-subtle">{hint}</span> : null}
        onClick={() => {
          if (fired.current) {
            fired.current = false;
            return;
          }
          onOpen();
        }}
      />
      <IconButton aria-label={actionsLabel} onClick={onOpen}>
        <EllipsisVertical />
      </IconButton>
    </div>
  );
}
