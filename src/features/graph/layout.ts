import type { GraphEdge } from "@/ipc/bindings";

export const ROW_HEIGHT = 28;
export const LANE_WIDTH = 14;
export const NODE_RADIUS = 4;
export const LANE_PADDING = 10;
export const LANE_COLORS = 8;
export const MAX_GUTTER = 260;

/** X centre of a lane. */
export function laneX(lane: number): number {
  return LANE_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/** Width of the lane gutter for a graph with `laneCount` lanes. */
export function gutterWidth(laneCount: number): number {
  return Math.min(MAX_GUTTER, LANE_PADDING * 2 + Math.max(1, laneCount) * LANE_WIDTH);
}

/** Index into the eight CSS lane variables. */
export function colorIndex(color: number): number {
  return ((color % LANE_COLORS) + LANE_COLORS) % LANE_COLORS;
}

export function laneColor(palette: readonly string[], color: number): string {
  return palette[colorIndex(color)] ?? palette[0] ?? "currentColor";
}

export type EdgeGeometry =
  | { type: "line"; x0: number; y0: number; x1: number; y1: number }
  | {
      type: "curve";
      x0: number;
      y0: number;
      cx0: number;
      cy0: number;
      cx1: number;
      cy1: number;
      x1: number;
      y1: number;
    };

/**
 * Geometry of an edge leaving the row whose top is `rowTop`, ending at the centre of the next row.
 * Straight edges are vertical; merge/branch edges are S-curves between lane centres.
 */
export function edgeGeometry(edge: GraphEdge, rowTop: number): EdgeGeometry {
  const y0 = rowTop + ROW_HEIGHT / 2;
  const y1 = y0 + ROW_HEIGHT;
  const x0 = laneX(edge.fromLane);
  const x1 = laneX(edge.toLane);
  if (edge.kind === "straight" || x0 === x1) return { type: "line", x0, y0, x1, y1 };
  const mid = (y0 + y1) / 2;
  return { type: "curve", x0, y0, cx0: x0, cy0: mid, cx1: x1, cy1: mid, x1, y1 };
}

export interface VisibleRange {
  first: number;
  last: number;
}

/** Rows to draw for a scroll position: the visible rows plus one above and below (clamped). */
export function drawRange(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  pad = 1,
): VisibleRange {
  if (rowCount <= 0) return { first: 0, last: -1 };
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - pad);
  const last = Math.min(rowCount - 1, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + pad);
  return { first, last };
}
