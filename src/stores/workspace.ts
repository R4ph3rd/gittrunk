import { create } from "zustand";

export type CenterView =
  | { kind: "graph" }
  | { kind: "commitDiff"; oid: string; path: string }
  | { kind: "worktreeDiff"; path: string; staged: boolean }
  | { kind: "issues" }
  | { kind: "issue"; number: number }
  | { kind: "newIssue" }
  | { kind: "pulls" }
  | { kind: "pull"; number: number };
export type ForgeCenterView = Extract<CenterView, { kind: "issues" | "issue" | "newIssue" }>;
export type PullCenterView = Extract<CenterView, { kind: "pulls" | "pull" }>;
export type RightTab = "commit" | "changes";

const MAX_STACK = 20;
const GRAPH: CenterView = { kind: "graph" };
const NO_STACK: CenterView[] = [];

const isDiff = (v: CenterView) => v.kind === "commitDiff" || v.kind === "worktreeDiff";

function same(a: CenterView, b: CenterView): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface WorkspaceState {
  /** Per repo; top = shown; empty = graph. */
  stacks: Record<string, CenterView[]>;
  /** Default "commit". */
  rightTab: Record<string, RightTab>;
  /** Push `view`. "graph" clears the stack; a diff opened while a diff is on top replaces it;
   *  a view equal to the top is ignored; the stack is capped at 20. */
  open(repoId: string, view: CenterView): void;
  /** Pop one (no-op when empty). */
  back(repoId: string): void;
  /** Clear. */
  showGraph(repoId: string): void;
  setRightTab(repoId: string, tab: RightTab): void;
  forget(repoId: string): void;
  reset(): void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  stacks: {},
  rightTab: {},
  open: (repoId, view) =>
    set((s) => {
      const stack = s.stacks[repoId] ?? NO_STACK;
      if (view.kind === "graph") {
        if (stack.length === 0) return s;
        return { stacks: { ...s.stacks, [repoId]: [] } };
      }
      const top = stack[stack.length - 1];
      if (top && same(top, view)) return s;
      const base = top && isDiff(top) && isDiff(view) ? stack.slice(0, -1) : stack;
      const next = [...base, view].slice(-MAX_STACK);
      return { stacks: { ...s.stacks, [repoId]: next } };
    }),
  back: (repoId) =>
    set((s) => {
      const stack = s.stacks[repoId];
      if (!stack || stack.length === 0) return s;
      return { stacks: { ...s.stacks, [repoId]: stack.slice(0, -1) } };
    }),
  showGraph: (repoId) => get().open(repoId, GRAPH),
  setRightTab: (repoId, tab) =>
    set((s) => (s.rightTab[repoId] === tab ? s : { rightTab: { ...s.rightTab, [repoId]: tab } })),
  forget: (repoId) =>
    set((s) => {
      if (!(repoId in s.stacks) && !(repoId in s.rightTab)) return s;
      const stacks = { ...s.stacks };
      const rightTab = { ...s.rightTab };
      delete stacks[repoId];
      delete rightTab[repoId];
      return { stacks, rightTab };
    }),
  reset: () => set({ stacks: {}, rightTab: {} }),
}));

/** The view on top of the stack, or the graph. */
export function useCenterView(repoId: string): CenterView {
  return useWorkspaceStore((s) => s.stacks[repoId]?.at(-1)) ?? GRAPH;
}

export function useRightTab(repoId: string): RightTab {
  return useWorkspaceStore((s) => s.rightTab[repoId]) ?? "commit";
}

const open = (repoId: string, view: CenterView) => useWorkspaceStore.getState().open(repoId, view);

export const openCommitDiff = (repoId: string, oid: string, path: string) =>
  open(repoId, { kind: "commitDiff", oid, path });
export const openWorktreeDiff = (repoId: string, path: string, staged: boolean) =>
  open(repoId, { kind: "worktreeDiff", path, staged });
export const openIssues = (repoId: string) => open(repoId, { kind: "issues" });
export const openIssue = (repoId: string, number: number) =>
  open(repoId, { kind: "issue", number });
export const openPulls = (repoId: string) => open(repoId, { kind: "pulls" });
export const openPull = (repoId: string, number: number) => open(repoId, { kind: "pull", number });
export const openNewIssue = (repoId: string) => open(repoId, { kind: "newIssue" });
export const showGraph = (repoId: string) => useWorkspaceStore.getState().showGraph(repoId);
