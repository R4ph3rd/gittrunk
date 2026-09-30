const UNITS: [number, string][] = [
  [60 * 60 * 24 * 365, "y"],
  [60 * 60 * 24 * 30, "mo"],
  [60 * 60 * 24 * 7, "w"],
  [60 * 60 * 24, "d"],
  [60 * 60, "h"],
  [60, "m"],
];

/** Compact relative date from a unix-seconds timestamp ("3d ago"). */
export function relativeDate(unixSeconds: number | null, nowMs = Date.now()): string {
  if (unixSeconds === null) return "";
  const diff = Math.max(0, Math.floor(nowMs / 1000 - unixSeconds));
  for (const [secs, label] of UNITS) {
    if (diff >= secs) return `${Math.floor(diff / secs)}${label} ago`;
  }
  return "just now";
}

export function absoluteDate(unixSeconds: number | null): string {
  return unixSeconds === null ? "" : new Date(unixSeconds * 1000).toLocaleString();
}
