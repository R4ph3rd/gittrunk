import { create } from "zustand";
import { useRepoStore } from "./repo";

export type TabId = "history" | "changes" | "branches" | "issues" | "more";
export type Route =
  | { name: "commit"; oid: string } // UI-C
  | { name: "commitFile"; oid: string; path: string } // UI-C
  | { name: "fileHistory"; path: string } // UI-C
  | { name: "reflog"; ref: string | null } // UI-C
  | { name: "worktreeDiff"; path: string; staged: boolean } // UI-B
  | { name: "compose" } // UI-B
  | { name: "conflicts" } // UI-B
  | { name: "conflict"; path: string } // UI-B
  | { name: "stash" } // UI-B
  | { name: "issue"; number: number } // UI-FORGE
  | { name: "newIssue" } // UI-FORGE
  | { name: "pull"; number: number } // UI-PULLS
  | { name: "settings"; section?: "general" | "git" | "ai" | "integrations" | "ssh" }; // UI-A
export type RouteName = Route["name"];

export interface RepoNav {
  tab: TabId;
  stack: Route[];
}

/** Key used for navigation state while no repository is open. */
export const NO_REPO = "__none__";

const ROOT: RepoNav = { tab: "history", stack: [] };

interface NavState {
  byRepo: Record<string, RepoNav>;
  /** Switching tab clears the stack. */
  setTab(repoId: string, tab: TabId): void;
  push(repoId: string, route: Route): void;
  /** False when the stack was empty. */
  pop(repoId: string): boolean;
  replace(repoId: string, route: Route): void;
  /** Clear the stack. */
  resetTab(repoId: string): void;
  /** On repo close. */
  forget(repoId: string): void;
}

const navOf = (s: NavState, repoId: string): RepoNav => s.byRepo[repoId] ?? ROOT;

export const useNavStore = create<NavState>((set, get) => ({
  byRepo: {},
  setTab: (repoId, tab) => set((s) => ({ byRepo: { ...s.byRepo, [repoId]: { tab, stack: [] } } })),
  push: (repoId, route) =>
    set((s) => {
      const cur = navOf(s, repoId);
      return { byRepo: { ...s.byRepo, [repoId]: { ...cur, stack: [...cur.stack, route] } } };
    }),
  pop: (repoId) => {
    const cur = navOf(get(), repoId);
    if (cur.stack.length === 0) return false;
    set((s) => ({
      byRepo: { ...s.byRepo, [repoId]: { ...cur, stack: cur.stack.slice(0, -1) } },
    }));
    return true;
  },
  replace: (repoId, route) =>
    set((s) => {
      const cur = navOf(s, repoId);
      return {
        byRepo: { ...s.byRepo, [repoId]: { ...cur, stack: [...cur.stack.slice(0, -1), route] } },
      };
    }),
  resetTab: (repoId) =>
    set((s) => {
      const cur = navOf(s, repoId);
      if (cur.stack.length === 0) return s;
      return { byRepo: { ...s.byRepo, [repoId]: { ...cur, stack: [] } } };
    }),
  forget: (repoId) =>
    set((s) => {
      if (!(repoId in s.byRepo)) return s;
      const byRepo = { ...s.byRepo };
      delete byRepo[repoId];
      return { byRepo };
    }),
}));

/** Navigation for the active repository (or the `NO_REPO` bucket on the welcome screen). */
export function useNav() {
  const repoId = useRepoStore((s) => s.activeId) ?? NO_REPO;
  const nav = useNavStore((s) => s.byRepo[repoId]) ?? ROOT;
  const { tab, stack } = nav;
  return {
    repoId,
    tab,
    stack,
    top: stack[stack.length - 1] ?? null,
    push: (route: Route) => useNavStore.getState().push(repoId, route),
    pop: () => useNavStore.getState().pop(repoId),
    replace: (route: Route) => useNavStore.getState().replace(repoId, route),
    setTab: (t: TabId) => useNavStore.getState().setTab(repoId, t),
    resetTab: () => useNavStore.getState().resetTab(repoId),
  };
}
