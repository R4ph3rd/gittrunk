import { describe, expect, it } from "vitest";
import { gittrunkHighlight } from "./cm";

describe("conflict editor highlight style", () => {
  it("uses only design token variables for colors", () => {
    const colors = gittrunkHighlight.specs.map((s) => s.color).filter(Boolean);
    expect(colors.length).toBeGreaterThan(8);
    for (const c of colors) expect(c).toMatch(/^var\(--[a-z0-9-]+\)$/);
  });
});
