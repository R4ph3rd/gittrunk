import { describe, expect, it } from "vitest";
import { LANE_COUNT, laneIndex, laneVar } from "./laneColor";

describe("laneColor", () => {
  it("wraps around the eight lane colors", () => {
    expect(LANE_COUNT).toBe(8);
    expect(laneIndex(0)).toBe(0);
    expect(laneIndex(7)).toBe(7);
    expect(laneIndex(8)).toBe(0);
    expect(laneIndex(19)).toBe(3);
  });

  it("is negative-safe", () => {
    expect(laneIndex(-1)).toBe(7);
    expect(laneIndex(-8)).toBe(0);
    expect(laneIndex(-9)).toBe(7);
  });

  it("formats a CSS variable reference", () => {
    expect(laneVar(10)).toBe("var(--lane-2)");
    expect(laneVar(-1)).toBe("var(--lane-7)");
  });
});
