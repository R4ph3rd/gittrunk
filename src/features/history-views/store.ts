import { create } from "zustand";

export type HistoryView =
  | { kind: "blame"; repoId: string; path: string; rev: string | null }
  | { kind: "history"; repoId: string; path: string }
  | { kind: "reflog"; repoId: string; refName: string };

export type PathPromptMode = "blame" | "history";

interface HistoryViewsState {
  view: HistoryView | null;
  /** The "pick a file" prompt behind the palette commands. */
  prompt: { repoId: string; mode: PathPromptMode } | null;
  addWorktreeFor: string | null;
  open: (view: HistoryView) => void;
  close: () => void;
  openPrompt: (repoId: string, mode: PathPromptMode) => void;
  closePrompt: () => void;
  openAddWorktree: (repoId: string) => void;
  closeAddWorktree: () => void;
}

export const useHistoryViews = create<HistoryViewsState>((set) => ({
  view: null,
  prompt: null,
  addWorktreeFor: null,
  open: (view) => set({ view, prompt: null }),
  close: () => set({ view: null }),
  openPrompt: (repoId, mode) => set({ prompt: { repoId, mode } }),
  closePrompt: () => set({ prompt: null }),
  openAddWorktree: (repoId) => set({ addWorktreeFor: repoId }),
  closeAddWorktree: () => set({ addWorktreeFor: null }),
}));

export const openBlame = (repoId: string, path: string, rev: string | null = null) =>
  useHistoryViews.getState().open({ kind: "blame", repoId, path, rev });
export const openFileHistory = (repoId: string, path: string) =>
  useHistoryViews.getState().open({ kind: "history", repoId, path });
export const openReflog = (repoId: string, refName = "HEAD") =>
  useHistoryViews.getState().open({ kind: "reflog", repoId, refName });
