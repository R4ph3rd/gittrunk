import type { BlameHunk } from "@/ipc/bindings";

export interface BlameRow {
  line: string;
  hunkIndex: number;
  /** True on the first line of a hunk, where the gutter shows the commit. */
  first: boolean;
}

/** One entry per file line, linking each to its hunk (hunks may arrive in any order). */
export function groupBlame(lines: string[], hunks: BlameHunk[]): BlameRow[] {
  const rows: BlameRow[] = lines.map((line) => ({ line, hunkIndex: -1, first: false }));
  hunks.forEach((h, hunkIndex) => {
    for (let n = 0; n < h.lineCount; n++) {
      const row = rows[h.startLine - 1 + n];
      if (row) {
        row.hunkIndex = hunkIndex;
        row.first = n === 0;
      }
    }
  });
  return rows;
}
