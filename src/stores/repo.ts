import { create } from "zustand";
import type { GraphFilter, RepoInfo } from "@/ipc/bindings";
import { getGraphOrder } from "./settings";

export const DEFAULT_FILTER: GraphFilter = {
  refs: null,
  firstParent: false,
  order: "topo",
  author: null,
  path: null,
  since: null,
  until: null,
};

/** What the right-hand panel shows: a commit's details or the working copy (WIP). */
export type Selection = { kind: "commit"; oid: string } | { kind: "wip" };

export type DiffMode = "split" | "unified";
const DIFF_MODE_KEY = "gittrunk.diffMode";

function readDiffMode(): DiffMode {
  try {
    return window.localStorage.getItem(DIFF_MODE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

/** What the desktop shell shows below the tab strip. */
export type ShellPage = { kind: "repo" } | { kind: "home" } | { kind: "newTab"; id: string };

const REPO_PAGE: ShellPage = { kind: "repo" };
let newTabCounter = 0;

interface RepoState {
  /** Open repositories, in tab order. */
  repos: RepoInfo[];
  activeId: string | null;
  page: ShellPage;
  /** "New tab" placeholders, rendered after the repository tabs, in order. */
  newTabs: string[];
  selection: Record<string, Selection | null>;
  filters: Record<string, GraphFilter>;
  openError: string | null;
  diffMode: DiffMode;
  /** Stash dialog visibility per repo (opened from the staging panel or the palette). */
  stashDialog: Record<string, boolean>;
  /** Appends a placeholder (`new-<n>`, module counter), shows it and returns its id. */
  openNewTab: () => string;
  /** Removes a placeholder. If it was shown: show the placeholder now at the same index, else the
   *  previous one, else { kind: "repo" }. */
  closeNewTab: (id: string) => void;
  showHome: () => void;
  showRepoPage: () => void;
  addRepo: (repo: RepoInfo) => void;
  removeRepo: (id: string) => void;
  setActive: (id: string) => void;
  select: (repoId: string, selection: Selection | null) => void;
  selectCommit: (repoId: string, oid: string | null) => void;
  selectWip: (repoId: string) => void;
  setFilter: (repoId: string, filter: GraphFilter) => void;
  setOpenError: (message: string | null) => void;
  setDiffMode: (mode: DiffMode) => void;
  setStashDialog: (repoId: string, open: boolean) => void;
}

export const useRepoStore = create<RepoState>((set) => ({
  repos: [],
  activeId: null,
  page: REPO_PAGE,
  newTabs: [],
  selection: {},
  filters: {},
  openError: null,
  diffMode: readDiffMode(),
  stashDialog: {},
  openNewTab: () => {
    newTabCounter += 1;
    const id = `new-${newTabCounter}`;
    set((s) => ({ newTabs: [...s.newTabs, id], page: { kind: "newTab", id } }));
    return id;
  },
  closeNewTab: (id) =>
    set((s) => {
      const idx = s.newTabs.indexOf(id);
      if (idx < 0) return s;
      const newTabs = s.newTabs.filter((t) => t !== id);
      const shown = s.page.kind === "newTab" && s.page.id === id;
      if (!shown) return { newTabs };
      const next = newTabs[idx] ?? newTabs[idx - 1];
      return { newTabs, page: next ? { kind: "newTab", id: next } : REPO_PAGE };
    }),
  showHome: () => set({ page: { kind: "home" } }),
  showRepoPage: () => set({ page: REPO_PAGE }),
  addRepo: (repo) =>
    set((s) => {
      const shown = s.page.kind === "newTab" ? s.page.id : null;
      const known = s.repos.some((r) => r.id === repo.id);
      // Newly opened repositories start with the graph order from settings.
      const order = getGraphOrder();
      const seed = !known && !s.filters[repo.id] && order !== DEFAULT_FILTER.order;
      return {
        repos: known ? s.repos.map((r) => (r.id === repo.id ? repo : r)) : [...s.repos, repo],
        activeId: repo.id,
        // The opened repository replaces the placeholder it was opened from.
        newTabs: shown === null ? s.newTabs : s.newTabs.filter((t) => t !== shown),
        page: REPO_PAGE,
        openError: null,
        filters: seed ? { ...s.filters, [repo.id]: { ...DEFAULT_FILTER, order } } : s.filters,
      };
    }),
  removeRepo: (id) =>
    set((s) => {
      const repos = s.repos.filter((r) => r.id !== id);
      const idx = s.repos.findIndex((r) => r.id === id);
      const activeId =
        s.activeId === id ? (repos[Math.min(idx, repos.length - 1)]?.id ?? null) : s.activeId;
      return { repos, activeId };
    }),
  setActive: (id) => set({ activeId: id, page: REPO_PAGE }),
  select: (repoId, selection) =>
    set((s) => ({ selection: { ...s.selection, [repoId]: selection } })),
  selectCommit: (repoId, oid) =>
    set((s) => ({
      selection: { ...s.selection, [repoId]: oid ? { kind: "commit", oid } : null },
    })),
  selectWip: (repoId) => set((s) => ({ selection: { ...s.selection, [repoId]: { kind: "wip" } } })),
  setFilter: (repoId, filter) => set((s) => ({ filters: { ...s.filters, [repoId]: filter } })),
  setOpenError: (openError) => set({ openError }),
  setDiffMode: (diffMode) => {
    try {
      window.localStorage.setItem(DIFF_MODE_KEY, diffMode);
    } catch {
      /* storage unavailable */
    }
    set({ diffMode });
  },
  setStashDialog: (repoId, open) =>
    set((s) => ({ stashDialog: { ...s.stashDialog, [repoId]: open } })),
}));

export function useActiveRepo(): RepoInfo | null {
  return useRepoStore((s) => s.repos.find((r) => r.id === s.activeId) ?? null);
}

/** The selected commit oid, or null when nothing or the WIP row is selected. */
export function selectedOidOf(selection: Selection | null | undefined): string | null {
  return selection?.kind === "commit" ? selection.oid : null;
}
