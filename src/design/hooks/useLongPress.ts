import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

export interface LongPressOptions {
  /** Hold time in ms. Default 450. */
  delay?: number;
  /** Movement in px that cancels the press. Default 8. */
  slop?: number;
  disabled?: boolean;
  /** `navigator.vibrate(10)` when it fires. Default true. */
  vibrate?: boolean;
}

/**
 * Long-press gesture. Spread the result onto the target. Cancels on movement past `slop`,
 * pointer up/cancel/leave and any scroll; suppresses the native contextmenu so the caller's
 * sheet is the only menu.
 */
export function useLongPress(
  onLongPress: (e: ReactPointerEvent) => void,
  { delay = 450, slop = 8, disabled = false, vibrate = true }: LongPressOptions = {},
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const handler = useRef(onLongPress);
  useEffect(() => {
    handler.current = onLongPress;
  });

  const onScroll = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
    if (onScroll.current) window.removeEventListener("scroll", onScroll.current, true);
    onScroll.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      cancel();
      origin.current = { x: e.clientX, y: e.clientY };
      onScroll.current = cancel;
      window.addEventListener("scroll", cancel, true);
      timer.current = setTimeout(() => {
        cancel();
        if (vibrate && typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate(10);
        }
        handler.current(e);
      }, delay);
    },
    [cancel, delay, disabled, vibrate],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const o = origin.current;
      if (!o) return;
      if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > slop) cancel();
    },
    [cancel, slop],
  );

  const onContextMenu = useCallback(
    (e: { preventDefault: () => void }) => {
      if (!disabled) e.preventDefault();
    },
    [disabled],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu,
  };
}
