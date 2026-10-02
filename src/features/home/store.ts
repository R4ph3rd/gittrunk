import { create } from "zustand";

export type WorkspaceDialogTarget = { mode: "create" } | { mode: "edit"; id: string };

interface HomeDialogsState {
  init: boolean;
  workspace: WorkspaceDialogTarget | null;
  openInit: () => void;
  openWorkspace: (target: WorkspaceDialogTarget) => void;
  close: () => void;
}

/** Visibility of the Create repository and workspace dialogs (rendered by `HomeHost`). */
export const useHomeDialogs = create<HomeDialogsState>((set) => ({
  init: false,
  workspace: null,
  openInit: () => set({ init: true, workspace: null }),
  openWorkspace: (workspace) => set({ workspace, init: false }),
  close: () => set({ init: false, workspace: null }),
}));
