import type { GraphRow } from "@/ipc/bindings";
import { initials } from "@/design/components/Avatar";
import type { Palette } from "./colors";
import {
  DESKTOP_METRICS,
  drawRange,
  edgeGeometry,
  laneColor,
  laneX,
  MERGE_NODE_RADIUS,
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
  /**
   * Avatar image of an author email (desktop style only): an image, `null`/`"loading"`/undefined
   * for the initials fallback. Called once per drawn non-merge row.
   */
  getAvatar?: (email: string) => CanvasImageSource | null | "loading" | undefined;
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
    const radius = m.avatarNodes && isMerge ? MERGE_NODE_RADIUS : m.nodeRadius;
    if (m.avatarNodes && row.refs.length > 0) {
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(cx - radius, cy);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.lineWidth = 1.5;
    }
    if (m.avatarNodes && !isMerge) drawAvatarNode(p, row, cx, cy, radius, color);
    else {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
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
    }
    if (p.headRow === i) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1.5;
    }
  }
}

/** Author avatar clipped to the node circle with a lane-colored ring, or an initials disc. */
function drawAvatarNode(
  p: DrawParams,
  row: GraphRow,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  const { ctx, palette } = p;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  const img = p.getAvatar?.(row.authorEmail);
  if (img && img !== "loading") {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = palette.avatarRing;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.lineWidth = 1.5;
  } else {
    ctx.fillStyle = palette.laneFg;
    ctx.font = `600 8px ${palette.fontSans}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(row.authorName), cx, cy + 0.5);
  }
}
