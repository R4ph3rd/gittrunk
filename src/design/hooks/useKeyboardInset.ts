import { useEffect, useState } from "react";

/**
 * Height in px covered by the soft keyboard, from `VisualViewport`. Writes `--kb-inset` on
 * `<html>` (removed on unmount). Returns 0 where `VisualViewport` is unavailable.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const next = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setInset(next);
      root.style.setProperty("--kb-inset", `${next}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--kb-inset");
    };
  }, []);

  return inset;
}
