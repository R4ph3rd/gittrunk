import { describe, expect, it } from "vitest";
import type { DiffLine, FileDiff, Hunk } from "@/ipc/bindings";
import { MAX_RENDERED_LINES, hunkHeader, toHunkStrings, visibleHunkCount } from "./toHunkStrings";

const ctx = (o: number, n: number, content: string): DiffLine => ({
  kind: "context",
  oldLineno: o,
  newLineno: n,
  content,
});
const add = (n: number, content: string): DiffLine => ({
  kind: "add",
  oldLineno: null,
  newLineno: n,
  content,
});
const del = (o: number, content: string): DiffLine => ({
  kind: "delete",
  oldLineno: o,
  newLineno: null,
  content,
});
const marker: DiffLine = { kind: "noNewline", oldLineno: null, newLineno: null, content: "" };

const hunk = (header: string, lines: DiffLine[], start = 1): Hunk => ({
  header,
  oldStart: start,
  oldLines: lines.filter((l) => l.kind !== "add" && l.kind !== "noNewline").length,
  newStart: start,
  newLines: lines.filter((l) => l.kind !== "delete" && l.kind !== "noNewline").length,
  lines,
});

const file = (hunks: Hunk[], extra: Partial<FileDiff> = {}): FileDiff => ({
  path: "src/a.ts",
  oldPath: null,
  status: "modified",
  binary: false,
  hunks,
  ...extra,
});

describe("toHunkStrings", () => {
  it("emits one self-contained unified diff per hunk", () => {
    const diff = file([
      hunk("@@ -1,2 +1,2 @@", [ctx(1, 1, "keep"), del(2, "old"), add(2, "new")]),
      hunk("@@ -10,1 +10,2 @@ fn x()", [ctx(10, 10, "tail"), add(11, "more")], 10),
    ]);
    expect(toHunkStrings(diff)).toEqual([
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n",
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10,1 +10,2 @@ fn x()\n tail\n+more\n",
    ]);
  });

  it("uses /dev/null for added and deleted files and the old path for renames", () => {
    const added = file([hunk("@@ -0,0 +1,1 @@", [add(1, "x")])], { status: "added" });
    expect(toHunkStrings(added)[0]).toMatch(/^--- \/dev\/null\n\+\+\+ b\/src\/a\.ts\n/);
    const untracked = { ...added, status: "untracked" as const };
    expect(toHunkStrings(untracked)[0]).toMatch(/^--- \/dev\/null\n/);
    const deleted = file([hunk("@@ -1,1 +0,0 @@", [del(1, "x")])], { status: "deleted" });
    expect(toHunkStrings(deleted)[0]).toMatch(/^--- a\/src\/a\.ts\n\+\+\+ \/dev\/null\n/);
    const renamed = file([hunk("@@ -1,1 +1,1 @@", [del(1, "a"), add(1, "b")])], {
      status: "renamed",
      oldPath: "src/old.ts",
    });
    expect(toHunkStrings(renamed)[0]).toMatch(/^--- a\/src\/old\.ts\n\+\+\+ b\/src\/a\.ts\n/);
  });

  it("keeps the no-newline-at-end-of-file marker after the line it belongs to", () => {
    const diff = file([hunk("@@ -1,1 +1,1 @@", [del(1, "a"), marker, add(1, "b"), marker])]);
    expect(toHunkStrings(diff)[0]).toBe(
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n",
    );
  });

  it("preserves CR of CRLF content and tolerates a trailing LF in content", () => {
    const diff = file([
      hunk("@@ -1,2 +1,2 @@", [del(1, "old\r"), add(1, "new\r"), ctx(2, 2, "same\n")]),
    ]);
    expect(toHunkStrings(diff)[0]).toBe(
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-old\r\n+new\r\n same\n",
    );
  });

  it("rebuilds a missing hunk header from the counts", () => {
    const h = { ...hunk("", [ctx(5, 5, "a"), add(6, "b")], 5), header: "" };
    expect(hunkHeader(h)).toBe("@@ -5 +5,2 @@");
    expect(hunkHeader({ ...h, oldLines: 1, newLines: 1 })).toBe("@@ -5 +5 @@");
  });

  it("returns nothing for a diff without hunks (binary, mode change)", () => {
    expect(toHunkStrings(file([], { binary: true }))).toEqual([]);
  });
});

describe("visibleHunkCount", () => {
  const big = (n: number) =>
    hunk(
      "@@ -1,1 +1,1 @@",
      Array.from({ length: n }, (_, i) => add(i + 1, "x")),
    );

  it("shows everything under the cap or when asked", () => {
    const small = file([big(10), big(10)]);
    expect(visibleHunkCount(small, false)).toBe(2);
    const huge = file([big(MAX_RENDERED_LINES - 10), big(50), big(50)]);
    expect(visibleHunkCount(huge, true)).toBe(3);
  });

  it("cuts at hunk boundaries and always keeps the first hunk", () => {
    const huge = file([big(MAX_RENDERED_LINES - 10), big(50), big(50)]);
    expect(visibleHunkCount(huge, false)).toBe(1);
    expect(visibleHunkCount(file([big(MAX_RENDERED_LINES + 5)]), false)).toBe(1);
  });
});
