import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export interface PullToRefreshProps {
  onRefresh: () => Promise<unknown>;
  /**
   * Scroller to watch. Default: the wrapper itself is the scroller. A custom element must be
   * the wrapper or a descendant of it.
   */
  getScrollElement?: () => HTMLElement | null;
  disabled?: boolean;
  /** Announced (role="status") while refreshing. Default "Refreshing". */
  label?: string;
  className?: string;
  children: ReactNode;
}

/** Pulling farther than this (px) at scrollTop 0 triggers a refresh. */
const THRESHOLD = 64;
/** Visual damping of the finger distance. */
const DAMPING = 0.5;
/** Resting offset of the content while refreshing, in px of indicator space. */
const HOLD = 40;

/**
 * Pull-down to refresh. Uses pointer events; while the scroller is at the top the wrapper
 * sets `touch-action: pan-x pan-up` so the browser leaves downward pans to us.
 */
export function PullToRefresh({
  onRefresh,
  getScrollElement,
  disabled,
  label = "Refreshing",
  className,
  children,
}: PullToRefreshProps) {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const startY = useRef<number | null>(null);
  const distance = useRef(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const scroller = () => getScrollElement?.() ?? wrapper.current;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Keep touch-action and overscroll containment in sync with the scroll position.
  useEffect(() => {
    const el = scroller();
    const w = wrapper.current;
    if (!el || !w) return;
    el.style.overscrollBehaviorY = "contain";
    const sync = () => {
      w.style.touchAction = el.scrollTop <= 0 && !disabled ? "pan-x pan-up" : "pan-y";
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    return () => el.removeEventListener("scroll", sync);
    // scroller() reads getScrollElement lazily; re-run when it or `disabled` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, getScrollElement]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || refreshing) return;
    const el = scroller();
    distance.current = 0;
    startY.current = el && el.scrollTop <= 0 ? e.clientY : null;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const y0 = startY.current;
    if (y0 === null) return;
    const el = scroller();
    if (!el || el.scrollTop > 0) {
      startY.current = null;
      distance.current = 0;
      setPull(0);
      return;
    }
    distance.current = Math.max(0, e.clientY - y0);
    setPull(distance.current);
  };

  const release = async (cancelled: boolean) => {
    if (startY.current === null) return;
    startY.current = null;
    const dist = distance.current;
    distance.current = 0;
    if (cancelled || dist <= THRESHOLD) {
      setPull(0);
      return;
    }
    setRefreshing(true);
    setPull(0);
    try {
      await onRefresh();
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };

  const offset = refreshing ? HOLD : pull * DAMPING;
  const active = pull > 0;

  return (
    <div
      ref={wrapper}
      className={cn("relative min-h-0 overflow-y-auto overscroll-y-contain", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => void release(false)}
      onPointerCancel={() => void release(true)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 flex h-10 items-center justify-center"
        style={{ opacity: refreshing || active ? 1 : 0 }}
      >
        {refreshing || pull > THRESHOLD ? (
          <Spinner className="text-accent" label={label} />
        ) : (
          <span
            className="h-0.5 w-8 rounded-full bg-accent"
            style={{ transform: `scaleX(${Math.min(1, pull / THRESHOLD)})` }}
          />
        )}
      </div>
      <span role="status" className="sr-only">
        {refreshing ? label : ""}
      </span>
      <div
        style={{
          transform: offset ? `translateY(${offset}px)` : undefined,
          transition: active ? "none" : "transform var(--duration-base) var(--ease-standard)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
