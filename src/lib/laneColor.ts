export const LANE_COUNT = 8;

/** Index into the eight --lane-N variables (negative-safe). */
export function laneIndex(color: number): number {
  return ((Math.trunc(color) % LANE_COUNT) + LANE_COUNT) % LANE_COUNT;
}

/** "var(--lane-N)" for inline styles. */
export function laneVar(color: number): string {
  return `var(--lane-${laneIndex(color)})`;
}
