import { describe, expect, it } from "vitest";
import { pageCount, pageOf, pagesForRange } from "./pages";

describe("page math", () => {
  it("maps rows to pages of 200", () => {
    expect(pageOf(0)).toBe(0);
    expect(pageOf(199)).toBe(0);
    expect(pageOf(200)).toBe(1);
    expect(pageCount(401)).toBe(3);
  });

  it("returns visible pages plus neighbours, clamped to the graph", () => {
    expect(pagesForRange(0, 20, 100_000)).toEqual([0, 1]);
    expect(pagesForRange(450, 470, 100_000)).toEqual([1, 2, 3]);
    expect(pagesForRange(190, 210, 400)).toEqual([0, 1]);
    expect(pagesForRange(0, 10, 0)).toEqual([]);
  });
});
