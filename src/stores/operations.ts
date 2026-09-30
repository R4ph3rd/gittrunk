import { create } from "zustand";

/** UI state for in-progress operations: which resolver / rebase editor / confirm is open per repo. */
interface OperationsState {
  /** Path of the conflicted file open in the resolver, per repo. */
  resolver: Record<string, string | null>;
  /** Base commit of the interactive rebase editor, per repo (null = closed). */
  rebase: Record<string, string | null>;
  /** Abort confirmation visibility, per repo (shared by the banner and the palette). */
  abortConfirm: Record<string, boolean>;
  openConflict: (repoId: string, path: string) => void;
  closeConflict: (repoId: string) => void;
  openRebase: (repoId: string, base: string) => void;
  closeRebase: (repoId: string) => void;
  setAbortConfirm: (repoId: string, open: boolean) => void;
  reset: () => void;
}

export const useOperationsStore = create<OperationsState>((set) => ({
  resolver: {},
  rebase: {},
  abortConfirm: {},
  openConflict: (repoId, path) => set((s) => ({ resolver: { ...s.resolver, [repoId]: path } })),
  closeConflict: (repoId) => set((s) => ({ resolver: { ...s.resolver, [repoId]: null } })),
  openRebase: (repoId, base) => set((s) => ({ rebase: { ...s.rebase, [repoId]: base } })),
  closeRebase: (repoId) => set((s) => ({ rebase: { ...s.rebase, [repoId]: null } })),
  setAbortConfirm: (repoId, open) =>
    set((s) => ({ abortConfirm: { ...s.abortConfirm, [repoId]: open } })),
  reset: () => set({ resolver: {}, rebase: {}, abortConfirm: {} }),
}));
