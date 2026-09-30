import type { DiffOptions, FileDiff, LineSelection } from "@/ipc/bindings";

/** A line of a diff: `line` indexes `Hunk.lines` of hunk `hunk` (what the backend expects). */
export interface LineRef {
  hunk: number;
  line: number;
}

export interface LineSelectionState {
  /** Selected changed lines as `"hunk:line"` keys. */
  keys: ReadonlySet<string>;
  /** Last plain-clicked line; Shift+click extends from here. */
  anchor: LineRef | null;
}

export const EMPTY_SELECTION: LineSelectionState = { keys: new Set(), anchor: null };

export const lineKey = (ref: LineRef) => `${ref.hunk}:${ref.line}`;

export function parseKey(key: string): LineRef {
  const [hunk = "0", line = "0"] = key.split(":");
  return { hunk: Number(hunk), line: Number(line) };
}

/** Every added/deleted line in display order (hunk by hunk). Context and markers are not selectable. */
export function changedLines(diff: FileDiff): LineRef[] {
  const out: LineRef[] = [];
  diff.hunks.forEach((h, hunk) =>
    h.lines.forEach((l, line) => {
      if (l.kind === "add" || l.kind === "delete") out.push({ hunk, line });
    }),
  );
  return out;
}

/**
 * Maps a clicked viewer row to a diff line. `side` says which line number the row carries:
 * old-side numbers identify deleted lines, new-side numbers identify added lines. Context rows
 * (present on both sides) resolve to null.
 */
export function findLine(
  diff: FileDiff,
  hunk: number,
  side: "old" | "new",
  lineNumber: number,
): LineRef | null {
  const lines = diff.hunks[hunk]?.lines;
  if (!lines) return null;
  const line = lines.findIndex((l) =>
    side === "old"
      ? l.kind === "delete" && l.oldLineno === lineNumber
      : l.kind === "add" && l.newLineno === lineNumber,
  );
  return line < 0 ? null : { hunk, line };
}

/**
 * Maps a clicked viewer row to a diff line using the row's own attributes: split rows carry
 * `data-side` and a `data-line-num` cell, unified rows carry `data-line-old-num`/`-new-num`
 * cells (only the side that exists on that row has a value).
 */
export function resolveRow(tr: HTMLElement, diff: FileDiff, hunkIndex: number): LineRef | null {
  const side = tr.getAttribute("data-side");
  if (side === "old" || side === "new") {
    const n = tr.querySelector("[data-line-num]")?.getAttribute("data-line-num");
    return n ? findLine(diff, hunkIndex, side, Number(n)) : null;
  }
  const oldNum = tr.querySelector("[data-line-old-num]")?.getAttribute("data-line-old-num");
  const newNum = tr.querySelector("[data-line-new-num]")?.getAttribute("data-line-new-num");
  if (oldNum && !newNum) return findLine(diff, hunkIndex, "old", Number(oldNum));
  if (newNum && !oldNum) return findLine(diff, hunkIndex, "new", Number(newNum));
  return null; // context row (both numbers) or a placeholder
}

/** Plain click: toggles one line and makes it the range anchor. */
export function toggleLine(state: LineSelectionState, ref: LineRef): LineSelectionState {
  const keys = new Set(state.keys);
  const key = lineKey(ref);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return { keys, anchor: ref };
}

/**
 * Shift+click: selects every changed line between the anchor and `ref` (inclusive, across hunk
 * boundaries, in display order) and keeps the anchor. Without an anchor it acts like a click.
 */
export function extendRange(
  diff: FileDiff,
  state: LineSelectionState,
  ref: LineRef,
): LineSelectionState {
  if (!state.anchor) return toggleLine(state, ref);
  const all = changedLines(diff);
  const anchorAt = all.findIndex(
    (r) => r.hunk === state.anchor!.hunk && r.line === state.anchor!.line,
  );
  const refAt = all.findIndex((r) => r.hunk === ref.hunk && r.line === ref.line);
  if (anchorAt < 0 || refAt < 0) return toggleLine(state, ref);
  const keys = new Set(state.keys);
  const [from, to] = anchorAt <= refAt ? [anchorAt, refAt] : [refAt, anchorAt];
  for (const r of all.slice(from, to + 1)) keys.add(lineKey(r));
  return { keys, anchor: state.anchor };
}

/** Selects every changed line of one hunk. */
export function selectHunk(diff: FileDiff, hunk: number): LineSelectionState {
  const keys = new Set(
    changedLines(diff)
      .filter((r) => r.hunk === hunk)
      .map(lineKey),
  );
  return { keys, anchor: null };
}

/**
 * Builds the backend selection. `options` must be exactly the options the diff was fetched with
 * (the backend re-diffs with them, and staging requires `ignoreWhitespace: false`). Returns null
 * for an empty selection.
 */
export function buildLineSelection(
  path: string,
  options: DiffOptions,
  state: LineSelectionState,
): LineSelection | null {
  const byHunk = new Map<number, number[]>();
  for (const key of state.keys) {
    const { hunk, line } = parseKey(key);
    byHunk.set(hunk, [...(byHunk.get(hunk) ?? []), line]);
  }
  if (byHunk.size === 0) return null;
  const hunks = [...byHunk.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hunkIndex, lines]) => ({ hunkIndex, lines: lines.sort((a, b) => a - b) }));
  return { path, options, hunks };
}

/** Whole-hunk selection (`lines: null`) for the per-hunk buttons. */
export function buildHunkSelection(
  path: string,
  options: DiffOptions,
  hunkIndex: number,
): LineSelection {
  return { path, options, hunks: [{ hunkIndex, lines: null }] };
}

export function selectedCount(state: LineSelectionState): number {
  return state.keys.size;
}
