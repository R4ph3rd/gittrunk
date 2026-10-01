import { describe, expect, it } from "vitest";
import type { GraphRow } from "@/ipc/bindings";
import { drawGraph } from "./draw";
import {
  COMPACT_METRICS,
  DESKTOP_METRICS,
  drawRange,
  edgeGeometry,
  effectiveDpr,
  gutterWidth,
  laneX,
  LANE_PADDING,
  LANE_WIDTH,
  MAX_GUTTER,
  NODE_RADIUS,
  ROW_HEIGHT,
  ROW_HEIGHT_COMPACT,
} from "./layout";

function row(i: number): GraphRow {
  return {
    index: i,
    oid: `${i}`.padStart(40, "0"),
    shortOid: `${i}`.padStart(7, "0"),
    summary: `commit ${i}`,
    authorName: "A",
    authorEmail: "a@example.com",
    authorTime: 0,
    parents: i % 5 === 0 ? ["p1", "p2"] : ["p1"],
    lane: i % 4,
    color: i % 8,
    edges: [
      { fromLane: i % 4, toLane: i % 4, kind: "straight", color: i % 8 },
      { fromLane: i % 4, toLane: (i + 1) % 4, kind: i % 2 ? "mergeIn" : "branchOut", color: 2 },
    ],
    refs: [],
  };
}

/** A canvas context that records every call and property write. */
function recordingCtx() {
  const log: unknown[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get:
      (_t, key) =>
      (...args: unknown[]) =>
        log.push([String(key), ...args]),
    set: (_t, key, value) => {
      log.push(["set", String(key), value]);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

const palette = {
  lanes: Array.from({ length: 8 }, (_, i) => `lane${i}`),
  accent: "a",
  surface: "s",
  laneFg: "fg",
  avatarRing: "ring",
  fontSans: "sans",
};

describe("GraphMetrics", () => {
  it("defaults equal the desktop constants", () => {
    expect(DESKTOP_METRICS).toMatchObject({
      rowHeight: ROW_HEIGHT,
      lanePitch: LANE_WIDTH,
      nodeRadius: NODE_RADIUS,
      lanePadding: LANE_PADDING,
      maxGutter: MAX_GUTTER,
    });
    expect(ROW_HEIGHT).toBe(28);
    expect(LANE_WIDTH).toBe(24);
    expect(NODE_RADIUS).toBe(9);
    expect(MAX_GUTTER).toBe(320);
    expect(DESKTOP_METRICS.overscan).toBe(6);
  });

  it("compact metrics use two-line rows, an 8 row overscan and a DPR cap of 2.5", () => {
    expect(COMPACT_METRICS.rowHeight).toBe(ROW_HEIGHT_COMPACT);
    expect(ROW_HEIGHT_COMPACT).toBe(56);
    expect(COMPACT_METRICS.lanePitch).toBe(14);
    expect(COMPACT_METRICS.nodeRadius).toBe(4);
    expect(COMPACT_METRICS.overscan).toBe(8);
    expect(effectiveDpr(3, COMPACT_METRICS)).toBe(2.5);
    expect(effectiveDpr(2, COMPACT_METRICS)).toBe(2);
    expect(effectiveDpr(3.5)).toBe(3.5);
    expect(effectiveDpr(0)).toBe(1);
  });

  it("caps the compact gutter at 40% of the list width", () => {
    expect(gutterWidth(500, COMPACT_METRICS, 390)).toBe(Math.floor(390 * 0.4));
    expect(gutterWidth(2, COMPACT_METRICS, 390)).toBe(10 * 2 + 2 * 14);
    expect(COMPACT_METRICS.maxGutter).toBe(260);
    expect(gutterWidth(500)).toBe(MAX_GUTTER);
  });

  it("scales lane geometry and the visible range with the row height", () => {
    expect(laneX(1, COMPACT_METRICS) - laneX(0, COMPACT_METRICS)).toBe(14);
    const g = edgeGeometry(
      { fromLane: 0, toLane: 0, kind: "straight", color: 0 },
      0,
      COMPACT_METRICS,
    );
    expect(g).toMatchObject({ y0: 28, y1: 84 });
    expect(drawRange(0, 560, 1000, 1, COMPACT_METRICS)).toEqual({ first: 0, last: 11 });
  });

  it("draws identical calls for the implicit and explicit desktop metrics", () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(i));
    const base = {
      width: 200,
      height: ROW_HEIGHT * 20,
      scrollTop: ROW_HEIGHT * 7,
      rowCount: 60,
      headRow: 9,
      palette,
      getRow: (i: number) => rows[i],
    };
    const a = recordingCtx();
    const b = recordingCtx();
    drawGraph({ ...base, ctx: a.ctx });
    drawGraph({ ...base, ctx: b.ctx, metrics: DESKTOP_METRICS });
    expect(a.log.length).toBeGreaterThan(50);
    expect(b.log).toEqual(a.log);
  });

  it("draws on the compact grid when given the compact metrics", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i));
    const rec = recordingCtx();
    drawGraph({
      ctx: rec.ctx,
      width: 80,
      height: 560,
      scrollTop: 0,
      rowCount: 30,
      headRow: 0,
      palette,
      getRow: (i) => rows[i],
      metrics: COMPACT_METRICS,
    });
    const arcs = rec.log.filter((c) => (c as unknown[])[0] === "arc") as number[][];
    // First node sits at the vertical centre of the first 56px row.
    expect(arcs[0]?.[2]).toBe(28);
  });
});
