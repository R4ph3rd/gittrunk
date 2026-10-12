import { describe, expect, it } from "vitest";
import { WAVE_BOTTOM, WAVE_LAYERS, WAVE_X_MAX, WAVE_X_MIN, waveY, wavePath } from "./mesh";

describe("wavePath", () => {
  it("is deterministic and closed along the bottom edge", () => {
    for (const layer of WAVE_LAYERS) {
      const d = wavePath(320, layer);
      expect(wavePath(320, layer)).toBe(d);
      expect(d.startsWith("M ")).toBe(true);
      expect(d.endsWith(` L ${WAVE_X_MAX} ${WAVE_BOTTOM} L ${WAVE_X_MIN} ${WAVE_BOTTOM} Z`)).toBe(
        true,
      );
      expect(d.match(/C/g)!.length).toBeGreaterThanOrEqual(6);
      for (const n of d.match(/-?\d+(\.\d+)?/g)!) expect(Number.isFinite(Number(n))).toBe(true);
    }
  });

  it("morphs with scroll: the curve changes, not just an offset", () => {
    for (const layer of WAVE_LAYERS) {
      const a = wavePath(0, layer);
      const b = wavePath(900, layer);
      expect(b).not.toBe(a);
      // Crest heights are not a uniform shift of one another.
      const diffs = [10, 40, 70].map((x) => waveY(x, 900, layer) - waveY(x, 0, layer));
      expect(Math.max(...diffs) - Math.min(...diffs)).toBeGreaterThan(0.5);
    }
  });

  it("keeps the crest in the lower part of the box for any scroll", () => {
    for (const layer of WAVE_LAYERS) {
      for (let s = 0; s <= 30000; s += 211) {
        for (let x = WAVE_X_MIN; x <= WAVE_X_MAX; x += 4) {
          const y = waveY(x, s, layer);
          expect(y).toBeGreaterThan(40);
          expect(y).toBeLessThan(90);
        }
      }
    }
  });

  it("has two distinct layers with weights in (0, 1]", () => {
    expect(WAVE_LAYERS).toHaveLength(2);
    expect(new Set(WAVE_LAYERS.map((l) => l.base)).size).toBe(2);
    for (const l of WAVE_LAYERS) {
      expect(l.weight).toBeGreaterThan(0);
      expect(l.weight).toBeLessThanOrEqual(1);
    }
  });
});
