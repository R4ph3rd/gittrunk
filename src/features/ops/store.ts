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

/** True while any operation for this repository is running. */
export function useRepoBusy(repoId: string): boolean {
  return useOpsStore((s) => Object.values(s.ops).some((o) => o.repoId === repoId));
}
