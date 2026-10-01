import { create } from "zustand";
import type { OpPreview } from "@/ipc/bindings";

export interface PushDialogState {
  repoId: string;
  /** Local branch to push. */
  branch: string;
}

export interface OplogPreviewState {
  repoId: string;
  preview: OpPreview;
  mode: "undo" | "redo";
}

interface RemotesUiState {
  cloneOpen: boolean;
  addRemoteFor: string | null;
  pushDialog: PushDialogState | null;
  forcePushFor: string | null;
  oplogPreview: OplogPreviewState | null;
  setCloneOpen: (open: boolean) => void;
  setAddRemoteFor: (repoId: string | null) => void;
  setPushDialog: (state: PushDialogState | null) => void;
  setForcePushFor: (repoId: string | null) => void;
  setOplogPreview: (state: OplogPreviewState | null) => void;
  setUndoPreview: (state: Omit<OplogPreviewState, "mode"> | null) => void;
  reset: () => void;
}

export const useRemotesUi = create<RemotesUiState>((set) => ({
  cloneOpen: false,
  addRemoteFor: null,
  pushDialog: null,
  forcePushFor: null,
  oplogPreview: null,
  setCloneOpen: (cloneOpen) => set({ cloneOpen }),
  setAddRemoteFor: (addRemoteFor) => set({ addRemoteFor }),
  setPushDialog: (pushDialog) => set({ pushDialog }),
  setForcePushFor: (forcePushFor) => set({ forcePushFor }),
  setOplogPreview: (oplogPreview) => set({ oplogPreview }),
  setUndoPreview: (undoPreview) =>
    set({
      oplogPreview: undoPreview ? { ...undoPreview, mode: "undo" } : null,
    }),
  reset: () =>
    set({
      cloneOpen: false,
      addRemoteFor: null,
      pushDialog: null,
      forcePushFor: null,
      oplogPreview: null,
    }),
}));
