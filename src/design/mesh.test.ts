import { describe, expect, it } from "vitest";
import { BLOBS, blobOffset, blobPath } from "./mesh";

describe("blobPath", () => {
  it("is deterministic per seed and differs between seeds", () => {
    expect(blobPath(5)).toBe(blobPath(5));
    expect(blobPath(5)).not.toBe(blobPath(6));
  });

  it("is a closed cubic path with finite coordinates inside the 100x100 box", () => {
    for (const seed of [1, 7, 99, 12345]) {
      for (const points of [6, 7, 8]) {
        const d = blobPath(seed, points);
        expect(d.startsWith("M ")).toBe(true);
        expect(d.endsWith(" Z")).toBe(true);
        expect(d.match(/C/g)).toHaveLength(points);
        const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
        expect(nums).toHaveLength(2 + points * 6);
        for (const n of nums) {
          expect(Number.isFinite(n)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe("blobOffset", () => {
  it("has three blobs with distinct colors and phases", () => {
    expect(BLOBS).toHaveLength(3);
    expect(new Set(BLOBS.map((b) => b.color)).size).toBe(3);
    expect(new Set(BLOBS.map((b) => b.phase)).size).toBe(3);
  });

  it("keeps X dominant within spec ranges", () => {
    for (const b of BLOBS) {
      expect(b.ampX).toBeGreaterThanOrEqual(40);
      expect(b.ampX).toBeLessThanOrEqual(90);
      expect(b.ampY).toBeLessThanOrEqual(20);
      expect(b.period).toBeGreaterThanOrEqual(1200);
      expect(b.period).toBeLessThanOrEqual(2400);
      expect(b.ampX).toBeGreaterThan(b.ampY);
    }
  });

  it("is bounded by the amplitudes", () => {
    for (const b of BLOBS) {
      for (let s = 0; s <= 20000; s += 137) {
        const o = blobOffset(s, b);
        expect(Math.abs(o.x)).toBeLessThanOrEqual(b.ampX + 1e-9);
        expect(Math.abs(o.y)).toBeLessThanOrEqual(b.ampY + 1e-9);
      }
    }
  });

  it("starts at the phase position", () => {
    for (const b of BLOBS) {
      const o = blobOffset(0, b);
      expect(o.x).toBeCloseTo(b.ampX * Math.sin(b.phase));
      expect(o.y).toBeCloseTo(b.ampY * Math.sin(b.phase));
    }
  });

  it("moves blobs differently", () => {
    const xs = BLOBS.map((b) => blobOffset(900, b).x);
    expect(new Set(xs.map((x) => x.toFixed(3))).size).toBe(3);
  });
});
