import { describe, expect, it } from "vitest";
import type { GraphRow } from "@/ipc/bindings";
import { drawGraph } from "./draw";
import { ROW_HEIGHT } from "./layout";

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
};

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
});
