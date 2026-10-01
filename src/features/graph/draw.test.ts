import { describe, expect, it } from "vitest";
import type { GraphRow } from "@/ipc/bindings";
import { drawGraph, type DrawParams } from "./draw";
import { laneX, ROW_HEIGHT } from "./layout";

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

function fakeCtx() {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: () => () => undefined,
    set: () => true,
  });
  return ctx as unknown as CanvasRenderingContext2D;
}

const palette = {
  lanes: Array.from({ length: 8 }, (_, i) => `lane${i}`),
  accent: "a",
  surface: "s",
  laneFg: "fg",
  avatarRing: "ring",
  fontSans: "sans",
};

function recorder() {
  const log: unknown[][] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get:
      (_t, key) =>
      (...args: unknown[]) =>
        log.push([String(key), ...args]),
    set: () => true,
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

function frame(r: GraphRow, getAvatar?: DrawParams["getAvatar"]) {
  const rec = recorder();
  drawGraph({
    ctx: rec.ctx,
    width: 100,
    height: ROW_HEIGHT * 3,
    scrollTop: 0,
    rowCount: 1,
    headRow: null,
    palette,
    getRow: () => r,
    getAvatar,
  });
  return rec.log;
}
const called = (log: unknown[][], name: string) => log.filter((c) => c[0] === name);

describe("drawGraph", () => {
  it("draws only visible rows plus one above and below", () => {
    const requested = new Set<number>();
    drawGraph({
      ctx: fakeCtx(),
      width: 100,
      height: ROW_HEIGHT * 10,
      scrollTop: ROW_HEIGHT * 5000,
      rowCount: 100_000,
      headRow: null,
      palette,
      getRow: (i) => {
        requested.add(i);
        return row(i);
      },
    });
    expect(Math.min(...requested)).toBe(4999);
    expect(Math.max(...requested)).toBe(5011);
  });

  it("renders a 50 row frame well under the frame budget", () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(i));
    const params = {
      ctx: fakeCtx(),
      width: 200,
      height: ROW_HEIGHT * 48,
      scrollTop: 0,
      rowCount: 60,
      headRow: 3,
      palette,
      getRow: (i: number) => rows[i],
    };
    drawGraph(params); // warm up
    const runs = 50;
    const start = performance.now();
    for (let i = 0; i < runs; i++) drawGraph(params);
    const perFrame = (performance.now() - start) / runs;
    expect(perFrame).toBeLessThan(4);
  });

  it("draws a lane-colored connector from x=0 to the node on rows with refs", () => {
    const r = {
      ...row(1),
      refs: [{ name: "main", fullName: "refs/heads/main", kind: "localBranch", isHead: false }],
    } as GraphRow;
    const log = frame(r);
    const cx = laneX(r.lane);
    expect(called(log, "lineTo").some((c) => c[1] === cx - 9 && c[2] === 14)).toBe(true);
    expect(called(frame(row(1)), "lineTo").some((c) => c[1] === cx - 9)).toBe(false);
  });

  it("draws the avatar image clipped to the node, and initials without one", () => {
    const img = {} as CanvasImageSource;
    const withImg = frame(row(1), () => img);
    expect(called(withImg, "drawImage")).toHaveLength(1);
    expect(called(withImg, "clip")).toHaveLength(1);
    const without = frame(row(1), () => null);
    expect(called(without, "drawImage")).toHaveLength(0);
    expect(called(without, "fillText")[0]?.[1]).toBe("A?");
  });

  it("keeps merge commits as small hollow nodes", () => {
    const merge = { ...row(1), parents: ["a", "b"] };
    const log = frame(merge, () => ({}) as CanvasImageSource);
    expect(called(log, "drawImage")).toHaveLength(0);
    expect(called(log, "arc")[0]?.[3]).toBe(5);
  });
});
