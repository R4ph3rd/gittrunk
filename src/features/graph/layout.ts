import type { GraphEdge } from "@/ipc/bindings";

export const ROW_HEIGHT = 28;
export const LANE_WIDTH = 24;
export const NODE_RADIUS = 9;
export const LANE_PADDING = 10;
export const LANE_COLORS = 8;
export const MAX_GUTTER = 320;
/** Width of the refs column left of the lanes on desktop rows. */
export const REFS_COLUMN_WIDTH = 176;
/** Largest chip width in the refs column. */
export const REF_CHIP_MAX_WIDTH = 150;
/** Radius of the small hollow node of merge commits on the desktop graph. */
export const MERGE_NODE_RADIUS = 5;
const COMPACT_LANE_WIDTH = 14;
const COMPACT_NODE_RADIUS = 4;
const COMPACT_MAX_GUTTER = 260;
/** Row height of the two-line history list on compact layouts. */
export const ROW_HEIGHT_COMPACT = 56;
export const MAX_DPR_COMPACT = 2.5;
export const OVERSCAN = 6;
export const OVERSCAN_COMPACT = 8;
/** Widest lane gutter on compact layouts, as a fraction of the list width. */
export const GUTTER_FRACTION_COMPACT = 0.4;

/** Geometry knobs of the graph. The defaults are the desktop values. */
export interface GraphMetrics {
  rowHeight: number;
  lanePitch: number;
  nodeRadius: number;
  lanePadding: number;
  maxGutter: number;
  /** Largest device pixel ratio the canvas is rendered at. */
  dprCap: number;
  overscan: number;
  /** Cap for the gutter as a fraction of the list width; null for no relative cap. */
  gutterFraction: number | null;
  /** Desktop style: avatar nodes and connectors from the refs column to the node. */
  avatarNodes: boolean;
}

export const DESKTOP_METRICS: GraphMetrics = {
  rowHeight: ROW_HEIGHT,
  lanePitch: LANE_WIDTH,
  nodeRadius: NODE_RADIUS,
  lanePadding: LANE_PADDING,
  maxGutter: MAX_GUTTER,
  dprCap: Number.POSITIVE_INFINITY,
  overscan: OVERSCAN,
  gutterFraction: null,
  avatarNodes: true,
};

export const COMPACT_METRICS: GraphMetrics = {
  rowHeight: ROW_HEIGHT_COMPACT,
  lanePitch: COMPACT_LANE_WIDTH,
  nodeRadius: COMPACT_NODE_RADIUS,
  lanePadding: LANE_PADDING,
  maxGutter: COMPACT_MAX_GUTTER,
  dprCap: MAX_DPR_COMPACT,
  overscan: OVERSCAN_COMPACT,
  gutterFraction: GUTTER_FRACTION_COMPACT,
  avatarNodes: false,
};

/** Device pixel ratio the canvas is rendered at. */
export function effectiveDpr(dpr: number, m: GraphMetrics = DESKTOP_METRICS): number {
  return Math.min(dpr || 1, m.dprCap);
}

/** X centre of a lane. */
export function laneX(lane: number, m: GraphMetrics = DESKTOP_METRICS): number {
  return m.lanePadding + lane * m.lanePitch + m.lanePitch / 2;
}

/**
 * Width of the lane gutter for a graph with `laneCount` lanes. With a `gutterFraction` metric the
 * gutter never exceeds that share of `listWidth`.
 */
export function gutterWidth(
  laneCount: number,
  m: GraphMetrics = DESKTOP_METRICS,
  listWidth?: number,
): number {
  const cap =
    m.gutterFraction !== null && listWidth
      ? Math.min(m.maxGutter, Math.floor(listWidth * m.gutterFraction))
      : m.maxGutter;
  return Math.min(cap, m.lanePadding * 2 + Math.max(1, laneCount) * m.lanePitch);
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
export function edgeGeometry(
  edge: GraphEdge,
  rowTop: number,
  m: GraphMetrics = DESKTOP_METRICS,
): EdgeGeometry {
  const y0 = rowTop + m.rowHeight / 2;
  const y1 = y0 + m.rowHeight;
  const x0 = laneX(edge.fromLane, m);
  const x1 = laneX(edge.toLane, m);
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
  m: GraphMetrics = DESKTOP_METRICS,
): VisibleRange {
  if (rowCount <= 0) return { first: 0, last: -1 };
  const first = Math.max(0, Math.floor(scrollTop / m.rowHeight) - pad);
  const last = Math.min(rowCount - 1, Math.ceil((scrollTop + viewportHeight) / m.rowHeight) + pad);
  return { first, last };
}
