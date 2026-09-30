import { create } from "zustand";
import type { OpPreview, PullStrategy } from "@/ipc/bindings";

const PULL_KEY = "gittrunk.pullStrategy";

function readStrategy(): PullStrategy {
  try {
    const v = window.localStorage.getItem(PULL_KEY);
    return v === "rebase" || v === "ffOnly" ? v : "merge";
  } catch {
    return "merge";
  }
}

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
  /** Default pull strategy; moves to backend settings later. */
  pullStrategy: PullStrategy;
  cloneOpen: boolean;
  addRemoteFor: string | null;
  pushDialog: PushDialogState | null;
  forcePushFor: string | null;
  undoPreview: UndoPreviewState | null;
  setPullStrategy: (s: PullStrategy) => void;
  setCloneOpen: (open: boolean) => void;
  setAddRemoteFor: (repoId: string | null) => void;
  setPushDialog: (state: PushDialogState | null) => void;
  setForcePushFor: (repoId: string | null) => void;
  setUndoPreview: (state: UndoPreviewState | null) => void;
  reset: () => void;
}

export const useRemotesUi = create<RemotesUiState>((set) => ({
  pullStrategy: readStrategy(),
  cloneOpen: false,
  addRemoteFor: null,
  pushDialog: null,
  forcePushFor: null,
  undoPreview: null,
  setPullStrategy: (pullStrategy) => {
    try {
      window.localStorage.setItem(PULL_KEY, pullStrategy);
    } catch {
      /* storage unavailable */
    }
    set({ pullStrategy });
  },
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
