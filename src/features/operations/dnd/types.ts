import type { HeadState, MergeStrategy, ResetMode } from "@/ipc/bindings";

/** What is being dragged. `oid` is the commit the ref points at (the row it was dragged from). */
export type DragSource =
  | {
      kind: "branch";
      name: string;
      fullName: string;
      remote: boolean;
      isHead: boolean;
      oid: string;
    }
  | { kind: "tag"; name: string; fullName: string; oid: string }
  | { kind: "commit"; oid: string; shortOid: string; index?: number };

/** Where it can be dropped. */
export type DropTarget =
  | {
      kind: "branch";
      name: string;
      fullName: string;
      remote: boolean;
      isHead: boolean;
      oid: string;
    }
  | { kind: "commit"; oid: string; shortOid: string; index?: number };

/** Repository facts the drop table needs; computed once when a drag starts. */
export interface DropContext {
  head: HeadState | null;
  /** Commits reachable from HEAD in the cached graph rows, or null when unknown. */
  onHead: ReadonlySet<string> | null;
}

export type DropAction =
  | { type: "merge"; source: string; into: string | null; strategy: MergeStrategy }
  | { type: "rebase"; onto: string; branch: string }
  | { type: "cherryPick"; oid: string; targetBranch: string | null }
  | { type: "moveRef"; name: string; target: string; force: boolean }
  | { type: "reset"; target: string; mode: ResetMode }
  | { type: "interactiveRebase"; base: string };

export interface DropOption {
  id: string;
  label: string;
  destructive?: boolean;
  action: DropAction;
}

/** Payload attached to draggables and droppables. */
export interface DragData {
  repoId: string;
  source: DragSource;
}
export interface DropData {
  repoId: string;
  target: DropTarget;
}

export function sourceLabel(s: DragSource): string {
  return s.kind === "commit" ? s.shortOid : s.name;
}
export function targetLabel(t: DropTarget): string {
  return t.kind === "commit" ? t.shortOid : t.name;
}
