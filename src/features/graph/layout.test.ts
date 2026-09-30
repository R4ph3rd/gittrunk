import { describe, expect, it } from "vitest";
import {
  colorIndex,
  drawRange,
  edgeGeometry,
  gutterWidth,
  laneColor,
  laneX,
  LANE_WIDTH,
  MAX_GUTTER,
  ROW_HEIGHT,
} from "./layout";

describe("layout helpers", () => {
  it("places lanes LANE_WIDTH apart", () => {
    expect(laneX(1) - laneX(0)).toBe(LANE_WIDTH);
  });

  it("wraps color indices into the 8 lane variables", () => {
    expect(colorIndex(0)).toBe(0);
    expect(colorIndex(9)).toBe(1);
    expect(colorIndex(-1)).toBe(7);
    const palette = Array.from({ length: 8 }, (_, i) => `c${i}`);
    expect(laneColor(palette, 10)).toBe("c2");
  });

  it("caps the gutter width", () => {
    expect(gutterWidth(1)).toBeLessThan(gutterWidth(4));
    expect(gutterWidth(500)).toBe(MAX_GUTTER);
  });

  it("draws straight edges as vertical lines to the next row centre", () => {
    const g = edgeGeometry({ fromLane: 2, toLane: 2, kind: "straight", color: 0 }, 100);
    expect(g).toEqual({
      type: "line",
      x0: laneX(2),
      y0: 100 + ROW_HEIGHT / 2,
      x1: laneX(2),
      y1: 100 + ROW_HEIGHT / 2 + ROW_HEIGHT,
    });
  });

  it("draws merge and branch edges as curves between lane centres", () => {
    for (const kind of ["mergeIn", "branchOut"] as const) {
      const g = edgeGeometry({ fromLane: 0, toLane: 3, kind, color: 1 }, 0);
      expect(g.type).toBe("curve");
      if (g.type === "curve") {
        expect(g.x0).toBe(laneX(0));
        expect(g.x1).toBe(laneX(3));
        expect(g.cy0).toBe(g.cy1);
      }
    }
  });

  it("computes the draw range with one row of padding, clamped", () => {
    expect(drawRange(0, 280, 1000)).toEqual({ first: 0, last: 11 });
    expect(drawRange(ROW_HEIGHT * 100, 280, 1000)).toEqual({ first: 99, last: 111 });
    expect(drawRange(0, 280, 5)).toEqual({ first: 0, last: 4 });
    expect(drawRange(0, 280, 0).last).toBe(-1);
  });
});
