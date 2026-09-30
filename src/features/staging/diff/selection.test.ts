import { describe, expect, it } from "vitest";
import { makeWorktreeDiff } from "@/app/testing";
import type { DiffOptions } from "@/ipc/bindings";
import {
  EMPTY_SELECTION,
  buildHunkSelection,
  buildLineSelection,
  changedLines,
  extendRange,
  findLine,
  selectHunk,
  toggleLine,
  type LineSelectionState,
} from "./selection";

// Hunk 0 lines: 0 ctx, 1 -old a, 2 -old b, 3 +new A, 4 +new B, 5 +new C, 6 ctx. Hunk 1: 0 ctx, 1 +z, 2 ctx.
const diff = makeWorktreeDiff();
const options: DiffOptions = { contextLines: 3, ignoreWhitespace: false };
const ref = (hunk: number, line: number) => ({ hunk, line });

function click(state: LineSelectionState, hunk: number, line: number, shift = false) {
  return shift ? extendRange(diff, state, ref(hunk, line)) : toggleLine(state, ref(hunk, line));
}

describe("line selection", () => {
  it("only added and deleted lines are selectable", () => {
    expect(changedLines(diff).map((r) => `${r.hunk}:${r.line}`)).toEqual([
      "0:1",
      "0:2",
      "0:3",
      "0:4",
      "0:5",
      "1:1",
    ]);
  });

  it("maps viewer line numbers to diff line indices by side", () => {
    expect(findLine(diff, 0, "old", 3)).toEqual(ref(0, 2));
    expect(findLine(diff, 0, "new", 3)).toEqual(ref(0, 4));
    expect(findLine(diff, 1, "new", 22)).toEqual(ref(1, 1));
    // context lines and wrong-side numbers are not selectable
    expect(findLine(diff, 0, "new", 1)).toBeNull();
    expect(findLine(diff, 0, "old", 4)).toBeNull();
    expect(findLine(diff, 5, "new", 1)).toBeNull();
  });

  it("toggles single lines and builds a selection with the diff's own options", () => {
    let s = click(EMPTY_SELECTION, 0, 4);
    s = click(s, 0, 1);
    expect(buildLineSelection("src/lib.rs", options, s)).toEqual({
      path: "src/lib.rs",
      options,
      hunks: [{ hunkIndex: 0, lines: [1, 4] }],
    });
    s = click(s, 0, 4); // toggling again deselects
    expect(buildLineSelection("src/lib.rs", options, s)?.hunks).toEqual([
      { hunkIndex: 0, lines: [1] },
    ]);
    expect(buildLineSelection("src/lib.rs", options, click(s, 0, 1))).toBeNull();
  });

  it("Shift+click selects the range from the anchor, skipping context lines", () => {
    let s = click(EMPTY_SELECTION, 0, 2);
    s = click(s, 0, 5, true);
    expect(buildLineSelection("f", options, s)?.hunks).toEqual([
      { hunkIndex: 0, lines: [2, 3, 4, 5] },
    ]);
    expect(s.anchor).toEqual(ref(0, 2));
  });

  it("Shift+click works backwards and keeps earlier selections", () => {
    let s = click(EMPTY_SELECTION, 0, 1);
    s = click(s, 0, 5);
    s = click(s, 0, 3, true); // anchor is now line 5; range 3..5
    expect(buildLineSelection("f", options, s)?.hunks).toEqual([
      { hunkIndex: 0, lines: [1, 3, 4, 5] },
    ]);
  });

  it("ranges across a hunk boundary produce one entry per hunk in hunk order", () => {
    let s = click(EMPTY_SELECTION, 0, 4);
    s = click(s, 1, 1, true);
    expect(buildLineSelection("f", options, s)?.hunks).toEqual([
      { hunkIndex: 0, lines: [4, 5] },
      { hunkIndex: 1, lines: [1] },
    ]);
  });

  it("Shift+click without an anchor acts as a plain click", () => {
    const s = click(EMPTY_SELECTION, 1, 1, true);
    expect(buildLineSelection("f", options, s)?.hunks).toEqual([{ hunkIndex: 1, lines: [1] }]);
  });

  it("selectHunk selects every changed line of that hunk only", () => {
    expect(buildLineSelection("f", options, selectHunk(diff, 0))?.hunks).toEqual([
      { hunkIndex: 0, lines: [1, 2, 3, 4, 5] },
    ]);
  });

  it("whole-hunk selections use lines: null", () => {
    expect(buildHunkSelection("f", options, 1)).toEqual({
      path: "f",
      options,
      hunks: [{ hunkIndex: 1, lines: null }],
    });
  });
});
