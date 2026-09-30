import { create } from "zustand";
import type { GraphFilter, RepoInfo } from "@/ipc/bindings";

export const DEFAULT_FILTER: GraphFilter = {
  refs: null,
  firstParent: false,
  order: "topo",
  author: null,
  path: null,
  since: null,
  until: null,
};

interface RepoState {
  /** Open repositories, in tab order. */
  repos: RepoInfo[];
  activeId: string | null;
  selectedOid: Record<string, string | null>;
  filters: Record<string, GraphFilter>;
  openError: string | null;
  addRepo: (repo: RepoInfo) => void;
  removeRepo: (id: string) => void;
  setActive: (id: string) => void;
  selectCommit: (repoId: string, oid: string | null) => void;
  setFilter: (repoId: string, filter: GraphFilter) => void;
  setOpenError: (message: string | null) => void;
}

export const useRepoStore = create<RepoState>((set) => ({
  repos: [],
  activeId: null,
  selectedOid: {},
  filters: {},
  openError: null,
  addRepo: (repo) =>
    set((s) => ({
      repos: s.repos.some((r) => r.id === repo.id)
        ? s.repos.map((r) => (r.id === repo.id ? repo : r))
        : [...s.repos, repo],
      activeId: repo.id,
      openError: null,
    })),
  removeRepo: (id) =>
    set((s) => {
      const repos = s.repos.filter((r) => r.id !== id);
      const idx = s.repos.findIndex((r) => r.id === id);
      const activeId =
        s.activeId === id ? (repos[Math.min(idx, repos.length - 1)]?.id ?? null) : s.activeId;
      return { repos, activeId };
    }),
  setActive: (id) => set({ activeId: id }),
  selectCommit: (repoId, oid) => set((s) => ({ selectedOid: { ...s.selectedOid, [repoId]: oid } })),
  setFilter: (repoId, filter) => set((s) => ({ filters: { ...s.filters, [repoId]: filter } })),
  setOpenError: (openError) => set({ openError }),
}));

export function useActiveRepo(): RepoInfo | null {
  return useRepoStore((s) => s.repos.find((r) => r.id === s.activeId) ?? null);
}
