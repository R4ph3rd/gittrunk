interface Entry {
  media: string;
  matches: boolean;
  listeners: Set<(e: MediaQueryListEvent) => void>;
  list: MediaQueryList;
}

const original = {
  matchMedia: (window as { matchMedia?: typeof window.matchMedia }).matchMedia,
  width: window.innerWidth,
  height: window.innerHeight,
};

interface State {
  width: number;
  height: number;
  pointer: "coarse" | "fine";
}

let current: State | null = null;
// One live MediaQueryList per query string, like a browser's shared lists.
const live = new Map<string, Entry>();

function evalFeature(feature: string): boolean {
  const s = current;
  if (!s) return false;
  const m = /^\(\s*([a-z-]+)\s*(?::\s*([^)]+?))?\s*\)$/.exec(feature.trim());
  if (!m) return false;
  const name = m[1];
  const value = m[2]?.trim();
  const px = value ? parseFloat(value) : NaN;
  switch (name) {
    case "max-width":
      return s.width <= px;
    case "min-width":
      return s.width >= px;
    case "max-height":
      return s.height <= px;
    case "min-height":
      return s.height >= px;
    case "pointer":
      return s.pointer === value;
    case "hover":
      return value === "none" ? s.pointer === "coarse" : s.pointer === "fine";
    default:
      return false;
  }
}

function evalQuery(query: string): boolean {
  return query.split(",").some((part) => part.split(/\s+and\s+/i).every(evalFeature));
}

function getList(query: string): MediaQueryList {
  const existing = live.get(query);
  if (existing) return existing.list;
  const entry = {
    media: query,
    matches: evalQuery(query),
    listeners: new Set<(e: MediaQueryListEvent) => void>(),
  } as Entry;
  entry.list = {
    media: query,
    get matches() {
      return entry.matches;
    },
    onchange: null,
    addEventListener: (type: string, cb: (e: MediaQueryListEvent) => void) => {
      if (type === "change") entry.listeners.add(cb);
    },
    removeEventListener: (type: string, cb: (e: MediaQueryListEvent) => void) => {
      if (type === "change") entry.listeners.delete(cb);
    },
    addListener: (cb: (e: MediaQueryListEvent) => void) => entry.listeners.add(cb),
    removeListener: (cb: (e: MediaQueryListEvent) => void) => entry.listeners.delete(cb),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  live.set(query, entry);
  return entry.list;
}

function setSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

export function setViewport(
  width: number,
  height: number,
  opts?: { pointer?: "coarse" | "fine" },
): void {
  current = { width, height, pointer: opts?.pointer ?? (width < 768 ? "coarse" : "fine") };
  setSize(width, height);
  window.matchMedia = getList;
  for (const entry of live.values()) {
    const next = evalQuery(entry.media);
    if (next === entry.matches) continue;
    entry.matches = next;
    const ev = { matches: next, media: entry.media } as MediaQueryListEvent;
    for (const cb of [...entry.listeners]) cb(ev);
  }
  window.dispatchEvent(new Event("resize"));
}

export function resetViewport(): void {
  current = null;
  live.clear();
  if (original.matchMedia) window.matchMedia = original.matchMedia;
  else delete (window as { matchMedia?: unknown }).matchMedia;
  setSize(original.width, original.height);
}
