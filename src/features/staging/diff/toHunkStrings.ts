import type { DiffLine, FileDiff, Hunk } from "@/ipc/bindings";

export const NO_NEWLINE_MARKER = "\\ No newline at end of file";

const PREFIX: Record<DiffLine["kind"], string> = {
  context: " ",
  add: "+",
  delete: "-",
  noNewline: "",
};

/** Text of one line without a trailing LF. A CR (CRLF files) is kept so the viewer can show it. */
function lineText(line: DiffLine): string {
  if (line.kind === "noNewline") return NO_NEWLINE_MARKER;
  const content = line.content.endsWith("\n") ? line.content.slice(0, -1) : line.content;
  return PREFIX[line.kind] + content;
}

function rangeText(start: number, lines: number): string {
  return lines === 1 ? `${start}` : `${start},${lines}`;
}

/** `@@ -a,b +c,d @@`: the backend header when present, otherwise rebuilt from the counts. */
export function hunkHeader(hunk: Hunk): string {
  if (hunk.header.startsWith("@@")) return hunk.header.replace(/\r?\n$/, "");
  return `@@ -${rangeText(hunk.oldStart, hunk.oldLines)} +${rangeText(hunk.newStart, hunk.newLines)} @@`;
}

/** `---`/`+++` lines the viewer needs before the first hunk. */
export function fileHeader(diff: Pick<FileDiff, "path" | "oldPath" | "status">): string {
  const isNew = diff.status === "added" || diff.status === "untracked";
  const from = isNew ? "/dev/null" : `a/${diff.oldPath ?? diff.path}`;
  const to = diff.status === "deleted" ? "/dev/null" : `b/${diff.path}`;
  return `--- ${from}\n+++ ${to}\n`;
}

/** One hunk as unified-diff text (header line plus prefixed lines, each ending in LF). */
export function hunkBody(hunk: Hunk): string {
  return [hunkHeader(hunk), ...hunk.lines.map(lineText)].join("\n") + "\n";
}

/**
 * Converts a `FileDiff` to the `hunks: string[]` input of `@git-diff-view`: one self-contained
 * unified diff (file header plus a single hunk) per hunk, in order. Index `i` here is hunk `i` of
 * the `FileDiff`, which is what `HunkSelection.hunkIndex` refers to.
 */
export function toHunkStrings(diff: FileDiff): string[] {
  const header = fileHeader(diff);
  return diff.hunks.map((h) => header + hunkBody(h));
}

/** The viewer renders every line (no virtualization); larger diffs are cut at hunk boundaries. */
export const MAX_RENDERED_LINES = 4000;

/** Hunks to render: whole hunks up to the line cap (always at least one). */
export function visibleHunkCount(diff: FileDiff, showAll: boolean): number {
  if (showAll) return diff.hunks.length;
  let lines = 0;
  for (let i = 0; i < diff.hunks.length; i++) {
    lines += diff.hunks[i]?.lines.length ?? 0;
    if (lines > MAX_RENDERED_LINES) return Math.max(1, i);
  }
  return diff.hunks.length;
}

/** Number of body lines across the hunks (used to cap huge diffs). */
export function countLines(diff: FileDiff): number {
  return diff.hunks.reduce((n, h) => n + h.lines.length, 0);
}
