/**
 * Pure conflict-marker parsing. Handles 2-way (`<<<<<<<` / `=======` / `>>>>>>>`) and diff3
 * (`|||||||` base section) markers, LF and CRLF. A marker must start its line; `<<<<<<<<`
 * (8 chars) or `<<<<<<<x` is ordinary text. Inside a block only the *expected next* marker
 * counts, so marker-looking text in a section (for example a nested `<<<<<<<`) is content.
 * An unterminated `<<<<<<<` is plain text.
 */

export type BlockChoice = "ours" | "theirs" | "both" | "base";

export interface ConflictBlock {
  /** 0-based position among the blocks of the text. */
  index: number;
  /** Offset of the start of the `<<<<<<<` line. */
  from: number;
  /** Offset of the end of the `>>>>>>>` line, excluding its line break. */
  to: number;
  /** 0-based line numbers of the start and end marker lines. */
  startLine: number;
  endLine: number;
  oursLabel: string;
  theirsLabel: string;
  baseLabel: string | null;
  ours: string[];
  /** null for 2-way markers. */
  base: string[] | null;
  theirs: string[];
  /** Line break used at the block's start marker. */
  eol: "\n" | "\r\n";
}

interface Line {
  text: string;
  start: number;
  end: number;
  eol: string;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  const re = /\r?\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    lines.push({ text: text.slice(start, m.index), start, end: m.index, eol: m[0] });
    start = m.index + m[0].length;
  }
  lines.push({ text: text.slice(start), start, end: text.length, eol: "" });
  return lines;
}

const isMarker = (line: string, ch: string) =>
  line.startsWith(ch.repeat(7)) && (line.length === 7 || line[7] === " ");
const labelOf = (line: string) => line.slice(8).trim();

function parseFrom(
  lines: Line[],
  i: number,
  index: number,
): { block: ConflictBlock; next: number } | null {
  let state: "ours" | "base" | "theirs" = "ours";
  const ours: string[] = [];
  const theirs: string[] = [];
  let base: string[] | null = null;
  let baseLabel: string | null = null;
  const start = lines[i]!;
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j]!;
    const t = line.text;
    if (state === "ours") {
      if (isMarker(t, "|")) {
        state = "base";
        base = [];
        baseLabel = labelOf(t);
      } else if (t === "=======") state = "theirs";
      else ours.push(t);
    } else if (state === "base") {
      if (t === "=======") state = "theirs";
      else base!.push(t);
    } else if (isMarker(t, ">")) {
      return {
        next: j + 1,
        block: {
          index,
          from: start.start,
          to: line.end,
          startLine: i,
          endLine: j,
          oursLabel: labelOf(start.text),
          theirsLabel: labelOf(t),
          baseLabel,
          ours,
          base,
          theirs,
          eol: start.eol === "\r\n" ? "\r\n" : "\n",
        },
      };
    } else theirs.push(t);
  }
  return null;
}

export function parseConflicts(text: string): ConflictBlock[] {
  const lines = splitLines(text);
  const blocks: ConflictBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isMarker(lines[i]!.text, "<")) {
      const parsed = parseFrom(lines, i, blocks.length);
      if (parsed) {
        blocks.push(parsed.block);
        i = parsed.next;
        continue;
      }
    }
    i++;
  }
  return blocks;
}

export const countConflicts = (text: string) => parseConflicts(text).length;

/** Lines a choice puts in the result; null when the choice is unavailable (`base` on 2-way). */
export function choiceLines(block: ConflictBlock, choice: BlockChoice): string[] | null {
  switch (choice) {
    case "ours":
      return block.ours;
    case "theirs":
      return block.theirs;
    case "both":
      return [...block.ours, ...block.theirs];
    case "base":
      return block.base;
  }
}

export interface BlockEdit {
  from: number;
  to: number;
  insert: string;
}

/** The text change that replaces a whole block with the chosen side(s). */
export function blockEdit(
  block: ConflictBlock,
  choice: BlockChoice,
  textLength: number,
  eol: string = block.eol,
): BlockEdit | null {
  const lines = choiceLines(block, choice);
  if (!lines) return null;
  if (lines.length === 0) {
    // Removing the block also removes its own line break so no blank line is left behind.
    return { from: block.from, to: Math.min(textLength, block.to + eol.length), insert: "" };
  }
  return { from: block.from, to: block.to, insert: lines.join(eol) };
}

export function applyEdit(text: string, edit: BlockEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/** Resolves one block of `text`. Returns `text` unchanged when the choice is unavailable. */
export function resolveBlock(text: string, index: number, choice: BlockChoice): string {
  const block = parseConflicts(text)[index];
  if (!block) return text;
  const edit = blockEdit(block, choice, text.length);
  return edit ? applyEdit(text, edit) : text;
}

/** Resolves every block the same way (last to first so offsets stay valid). */
export function resolveAll(text: string, choice: BlockChoice): string {
  let out = text;
  const blocks = parseConflicts(text);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const edit = blockEdit(blocks[i]!, choice, out.length);
    if (edit) out = applyEdit(out, edit);
  }
  return out;
}

/** Index of the block after (or before) `offset`, wrapping around; -1 when there are none. */
export function nextBlock(blocks: ConflictBlock[], offset: number, dir: 1 | -1): number {
  if (blocks.length === 0) return -1;
  if (dir === 1) {
    const i = blocks.findIndex((b) => b.from > offset);
    return i < 0 ? 0 : i;
  }
  for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i]!.from < offset) return i;
  return blocks.length - 1;
}
