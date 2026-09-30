import type { CommitSummary, GraphRow, RefUpdate } from "@/ipc/bindings";

export type MiniNodeKind = "existing" | "created" | "dropped";

export interface MiniNode {
  oid: string;
  short: string;
  kind: MiniNodeKind;
  /** Short names of the refs sitting on this commit in this column. */
  refs: string[];
}

export interface MiniGraphModel {
  before: MiniNode[];
  after: MiniNode[];
  /** Commits left out of a column to keep the diagram small. */
  hiddenBefore: number;
  hiddenAfter: number;
}

export const MAX_NODES = 5;

export function shortRefName(name: string): string {
  return name.replace(/^refs\/(heads|tags|remotes)\//, "");
}

function column(
  entries: Array<{ oid: string; ref?: string; kind: MiniNodeKind }>,
  index: (oid: string) => number,
): { nodes: MiniNode[]; hidden: number } {
  const byOid = new Map<string, MiniNode>();
  for (const e of entries) {
    const node = byOid.get(e.oid) ?? {
      oid: e.oid,
      short: e.oid.slice(0, 7),
      kind: e.kind,
      refs: [],
    };
    if (e.ref && !node.refs.includes(e.ref)) node.refs.push(e.ref);
    byOid.set(e.oid, node);
  }
  // Newest first: unknown (freshly created) commits sit above cached rows, which sort by row index.
  const sorted = [...byOid.values()].sort((a, b) => index(a.oid) - index(b.oid));
  // Keep ref-carrying commits when trimming.
  const keep = new Set(
    [...sorted]
      .sort((a, b) => Number(b.refs.length > 0) - Number(a.refs.length > 0))
      .slice(0, MAX_NODES)
      .map((n) => n.oid),
  );
  return { nodes: sorted.filter((n) => keep.has(n.oid)), hidden: sorted.length - keep.size };
}

/**
 * Two columns of commits for the confirmation dialog: where the affected refs point before the
 * operation and where they will point after, drawn from `refUpdates` and the cached graph rows.
 */
export function buildMiniGraph(
  updates: RefUpdate[],
  dropped: CommitSummary[],
  rows: ReadonlyMap<string, GraphRow>,
): MiniGraphModel {
  const index = (oid: string) => rows.get(oid)?.index ?? -1;
  const before: Array<{ oid: string; ref?: string; kind: MiniNodeKind }> = [];
  const after: Array<{ oid: string; ref?: string; kind: MiniNodeKind }> = [];
  for (const u of updates) {
    const ref = shortRefName(u.name);
    if (u.from) before.push({ oid: u.from, ref, kind: "existing" });
    if (u.to) after.push({ oid: u.to, ref, kind: rows.has(u.to) ? "existing" : "created" });
  }
  for (const c of dropped) before.push({ oid: c.oid, kind: "dropped" });
  const b = column(before, index);
  const a = column(after, index);
  return { before: b.nodes, after: a.nodes, hiddenBefore: b.hidden, hiddenAfter: a.hidden };
}
