import type { GraphRow } from "@/ipc/bindings";
import type { Palette } from "./colors";
import {
  DESKTOP_METRICS,
  drawRange,
  edgeGeometry,
  laneColor,
  laneX,
  type GraphMetrics,
} from "./layout";

export interface DrawParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  scrollTop: number;
  rowCount: number;
  headRow: number | null;
  palette: Palette;
  getRow: (index: number) => GraphRow | undefined;
  /** Geometry; defaults to the desktop values. */
  metrics?: GraphMetrics;
}

/** Draws one frame: lane edges then nodes for the visible rows +/- 1. Coordinates are CSS pixels. */
export function drawGraph(p: DrawParams): void {
  const { ctx, palette } = p;
  const m = p.metrics ?? DESKTOP_METRICS;
  ctx.clearRect(0, 0, p.width, p.height);
  const { first, last } = drawRange(p.scrollTop, p.height, p.rowCount, 1, m);
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";

  for (let i = first; i <= last; i++) {
    const row = p.getRow(i);
    if (!row) continue;
    const top = i * m.rowHeight - p.scrollTop;
    for (const edge of row.edges) {
      const g = edgeGeometry(edge, top, m);
      ctx.strokeStyle = laneColor(palette.lanes, edge.color);
      ctx.beginPath();
      ctx.moveTo(g.x0, g.y0);
      if (g.type === "line") ctx.lineTo(g.x1, g.y1);
      else ctx.bezierCurveTo(g.cx0, g.cy0, g.cx1, g.cy1, g.x1, g.y1);
      ctx.stroke();
    }
  }

  for (let i = first; i <= last; i++) {
    const row = p.getRow(i);
    if (!row) continue;
    const cx = laneX(row.lane, m);
    const cy = i * m.rowHeight - p.scrollTop + m.rowHeight / 2;
    const color = laneColor(palette.lanes, row.color);
    const isMerge = row.parents.length > 1;
    ctx.beginPath();
    ctx.arc(cx, cy, m.nodeRadius, 0, Math.PI * 2);
    if (isMerge) {
      ctx.fillStyle = palette.surface;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (p.headRow === i) {
      ctx.beginPath();
      ctx.arc(cx, cy, m.nodeRadius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1.5;
    }
  }
}
