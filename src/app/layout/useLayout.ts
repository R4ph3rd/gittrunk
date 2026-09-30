import { createContext, useContext, useSyncExternalStore } from "react";
import { COARSE_QUERY, COMPACT_QUERY, SHORT_QUERY } from "./queries";

export type LayoutMode = "compact" | "regular";

export interface Layout {
  mode: LayoutMode;
  isCompact: boolean;
  isShort: boolean;
  isCoarse: boolean;
}

export const REGULAR_LAYOUT: Layout = {
  mode: "regular",
  isCompact: false,
  isShort: false,
  isCoarse: false,
};

/** Overrides set by LayoutProvider; null when no provider is mounted. */
export const LayoutOverrideContext = createContext<Partial<Layout> | null>(null);

function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {};
  const lists = [COMPACT_QUERY, SHORT_QUERY, COARSE_QUERY].map((q) => window.matchMedia(q));
  for (const l of lists) l.addEventListener("change", onChange);
  return () => {
    for (const l of lists) l.removeEventListener("change", onChange);
  };
}

// The snapshot is a string so useSyncExternalStore compares it by value.
function getSnapshot(): string {
  if (!hasMatchMedia()) return "000";
  const bit = (q: string) => (window.matchMedia(q).matches ? "1" : "0");
  return bit(COMPACT_QUERY) + bit(SHORT_QUERY) + bit(COARSE_QUERY);
}

const cache = new Map<string, Layout>();

// Interned so consumers get a referentially stable object per flag combination.
function layoutFor(isCompact: boolean, isShort: boolean, isCoarse: boolean): Layout {
  const key = `${isCompact ? 1 : 0}${isShort ? 1 : 0}${isCoarse ? 1 : 0}`;
  let layout = cache.get(key);
  if (!layout) {
    layout = { mode: isCompact ? "compact" : "regular", isCompact, isShort, isCoarse };
    cache.set(key, layout);
  }
  return layout;
}

export function useLayout(): Layout {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => "000");
  const force = useContext(LayoutOverrideContext);
  return layoutFor(
    force?.isCompact ?? snap[0] === "1",
    force?.isShort ?? snap[1] === "1",
    force?.isCoarse ?? snap[2] === "1",
  );
}
