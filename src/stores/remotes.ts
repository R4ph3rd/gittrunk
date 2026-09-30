import { create } from "zustand";
import type { OpPreview } from "@/ipc/bindings";

export interface PushDialogState {
  repoId: string;
  /** Local branch to push. */
  branch: string;
}

export interface UndoPreviewState {
  repoId: string;
  preview: OpPreview;
}

interface RemotesUiState {
  cloneOpen: boolean;
  addRemoteFor: string | null;
  pushDialog: PushDialogState | null;
  forcePushFor: string | null;
  undoPreview: UndoPreviewState | null;
  setCloneOpen: (open: boolean) => void;
  setAddRemoteFor: (repoId: string | null) => void;
  setPushDialog: (state: PushDialogState | null) => void;
  setForcePushFor: (repoId: string | null) => void;
  setUndoPreview: (state: UndoPreviewState | null) => void;
  reset: () => void;
}

export const useRemotesUi = create<RemotesUiState>((set) => ({
  cloneOpen: false,
  addRemoteFor: null,
  pushDialog: null,
  forcePushFor: null,
  undoPreview: null,
  setCloneOpen: (cloneOpen) => set({ cloneOpen }),
  setAddRemoteFor: (addRemoteFor) => set({ addRemoteFor }),
  setPushDialog: (pushDialog) => set({ pushDialog }),
  setForcePushFor: (forcePushFor) => set({ forcePushFor }),
  setUndoPreview: (undoPreview) => set({ undoPreview }),
  reset: () =>
    set({
      cloneOpen: false,
      addRemoteFor: null,
      pushDialog: null,
      forcePushFor: null,
      undoPreview: null,
    }),
}));
