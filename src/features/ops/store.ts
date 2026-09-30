import { useMemo } from "react";
import { create } from "zustand";
import type { OpProgress } from "@/ipc/bindings";

export type OpKind = "fetch" | "pull" | "push" | "clone" | "submodule";

export interface RunningOp {
  id: string;
  kind: OpKind;
  /** Null for ops that have no repository yet (clone). */
  repoId: string | null;
  label: string;
  doneLabel: string;
  phase: string;
  percent: number | null;
  message: string | null;
  startedAt: number;
}

interface OpsState {
  ops: Record<string, RunningOp>;
  add: (op: Pick<RunningOp, "id" | "kind" | "repoId" | "label" | "doneLabel">) => void;
  progress: (p: OpProgress) => void;
  remove: (id: string) => void;
  reset: () => void;
}

export const useOpsStore = create<OpsState>((set) => ({
  ops: {},
  add: (op) =>
    set((s) => ({
      ops: {
        ...s.ops,
        [op.id]: { ...op, phase: "Starting", percent: null, message: null, startedAt: Date.now() },
      },
    })),
  progress: (p) =>
    set((s) => {
      const cur = s.ops[p.opId];
      if (!cur) return s;
      const next = { ...cur, phase: p.phase, percent: p.percent, message: p.message };
      return { ops: { ...s.ops, [p.opId]: next } };
    }),
  remove: (id) =>
    set((s) => {
      if (!(id in s.ops)) return s;
      const ops = { ...s.ops };
      delete ops[id];
      return { ops };
    }),
  reset: () => set({ ops: {} }),
}));

/** Ops shown for a repository: its own plus repo-less ones such as clone. */
export function useVisibleOps(repoId: string | null): RunningOp[] {
  const ops = useOpsStore((s) => s.ops);
  return useMemo(
    () => Object.values(ops).filter((o) => o.repoId === null || o.repoId === repoId),
    [ops, repoId],
  );
}

/**
 * Aggregate progress for the AppBar line: null when idle, "indeterminate" while any visible
 * op has no percentage, otherwise the mean of the percentages as a 0..1 fraction.
 */
export function useOpProgress(repoId: string | null): number | "indeterminate" | null {
  const ops = useVisibleOps(repoId);
  if (ops.length === 0) return null;
  if (ops.some((o) => o.percent === null)) return "indeterminate";
  return ops.reduce((sum, o) => sum + (o.percent ?? 0), 0) / ops.length / 100;
}

/** True while any operation for this repository is running. */
export function useRepoBusy(repoId: string): boolean {
  return useOpsStore((s) => Object.values(s.ops).some((o) => o.repoId === repoId));
}
