import { useEffect, useRef } from "react";
import { pushBackHandler, type BackHandler } from "./back";

/** Registers while mounted and enabled; always calls the latest handler. */
export function useBackHandler(handler: BackHandler, enabled = true): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    return pushBackHandler(() => ref.current());
  }, [enabled]);
}
