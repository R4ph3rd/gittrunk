import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { focusRing } from "./shared";

export interface SwipeAction {
  label: string;
  icon?: ReactNode;
  tone: "success" | "danger" | "neutral";
  onTrigger: () => void;
}

export interface SwipeRowProps {
  /** Revealed on the left edge by swiping RIGHT. */
  leftAction?: SwipeAction;
  /** Revealed on the right edge by swiping LEFT. */
  rightAction?: SwipeAction;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

/** Commit when dragged past this fraction of the row width... */
const COMMIT_FRACTION = 0.4;
/** ...or released faster than this (px/ms). */
const COMMIT_VELOCITY = 0.5;
/** Movement before a gesture counts as a drag (px). */
const SLOP = 8;

const tones = {
  success: "bg-success text-accent-fg",
  danger: "bg-danger text-[color:var(--danger-fg)]",
  neutral: "bg-surface-hover text-fg",
} as const;

function Reveal({ action, side }: { action: SwipeAction; side: "left" | "right" }) {
  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-y-0 flex w-full items-center gap-2 px-4 text-sm font-medium [&_svg]:size-4",
        side === "left" ? "left-0 justify-start" : "right-0 justify-end",
        tones[action.tone],
      )}
    >
      {action.icon}
      {action.label}
    </div>
  );
}

function ActionButton({ action, side }: { action: SwipeAction; side: "left" | "right" }) {
  return (
    <button
      type="button"
      onClick={action.onTrigger}
      className={cn(
        "sr-only focus:not-sr-only focus:absolute focus:inset-y-0 focus:z-10 focus:flex focus:items-center focus:gap-2 focus:px-4 focus:text-sm focus:font-medium",
        side === "left" ? "focus:left-0" : "focus:right-0",
        tones[action.tone],
        focusRing,
      )}
    >
      {action.icon}
      {action.label}
    </button>
  );
}

/**
 * Row with swipe actions. Swipe is an accelerator only: each action is also a real
 * `<button>` in the DOM, visually hidden until focused.
 */
export function SwipeRow({
  leftAction,
  rightAction,
  disabled,
  className,
  children,
}: SwipeRowProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const [dx, setDx] = useState(0);
  const [active, setActive] = useState(false);

  const allowed = (v: number) => (v > 0 ? !!leftAction : v < 0 ? !!rightAction : true);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
    start.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    dragging.current = false;
    moved.current = false;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!dragging.current) {
      if (Math.abs(my) > SLOP && Math.abs(my) > Math.abs(mx)) {
        start.current = null; // vertical intent: leave it to the scroller
        return;
      }
      if (Math.abs(mx) <= SLOP) return;
      dragging.current = true;
      moved.current = true;
      setActive(true);
      try {
        ref.current?.setPointerCapture?.(s.id);
      } catch {
        /* synthetic pointer without an active id */
      }
    }
    setDx(allowed(mx) ? mx : 0);
  };

  const finish = (cancelled: boolean) => {
    const s = start.current;
    start.current = null;
    if (!s || !dragging.current) return;
    dragging.current = false;
    setActive(false);
    const width = ref.current?.getBoundingClientRect().width ?? 0;
    const dt = Math.max(1, Date.now() - s.t);
    const dist = Math.abs(dx);
    const commit =
      !cancelled && dist > SLOP && (dist > width * COMMIT_FRACTION || dist / dt > COMMIT_VELOCITY);
    setDx(0); // spring back over --swipe-duration
    if (!commit) return;
    (dx > 0 ? leftAction : rightAction)?.onTrigger();
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {dx > 0 && leftAction ? <Reveal action={leftAction} side="left" /> : null}
      {dx < 0 && rightAction ? <Reveal action={rightAction} side="right" /> : null}
      {leftAction ? <ActionButton action={leftAction} side="left" /> : null}
      {rightAction ? <ActionButton action={rightAction} side="right" /> : null}
      <div
        ref={ref}
        data-swipe-content=""
        className="relative bg-surface"
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          touchAction: "pan-y",
          transition: active ? "none" : "transform var(--swipe-duration) var(--ease-standard)",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => finish(false)}
        onPointerCancel={() => finish(true)}
        onClickCapture={(e) => {
          if (moved.current) {
            e.stopPropagation();
            e.preventDefault();
            moved.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
