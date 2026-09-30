import { LANE_COLORS } from "./layout";

export interface Palette {
  lanes: string[];
  accent: string;
  surface: string;
}

/** Reads the lane colours (and accent/surface) from CSS variables once; call again on theme change. */
export function readPalette(el: Element = document.documentElement): Palette {
  const style = getComputedStyle(el);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const lanes: string[] = [];
  for (let i = 0; i < LANE_COLORS; i++) lanes.push(get(`--lane-${i}`, "currentColor"));
  return {
    lanes,
    accent: get("--accent", "currentColor"),
    surface: get("--surface", "transparent"),
  };
}

/** Calls `cb` when the theme may have changed (data-theme/class flips or the OS scheme changes). */
export function onThemeChange(cb: () => void): () => void {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class"],
  });
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  mq?.addEventListener?.("change", cb);
  return () => {
    observer.disconnect();
    mq?.removeEventListener?.("change", cb);
  };
}
