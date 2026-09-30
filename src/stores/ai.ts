import { create } from "zustand";

export interface PrDescriptionTarget {
  repoId: string;
  base: string;
  head: string;
}

interface AiState {
  settingsOpen: boolean;
  askRepoId: string | null;
  prTarget: PrDescriptionTarget | null;
  /** Set after the first "Send" of a payload preview; later actions in this session skip it. */
  previewAcked: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  openAsk: (repoId: string) => void;
  closeAsk: () => void;
  openPrDescription: (target: PrDescriptionTarget) => void;
  closePrDescription: () => void;
  ackPreview: () => void;
  reset: () => void;
}

const initial = {
  settingsOpen: false,
  askRepoId: null,
  prTarget: null,
  previewAcked: false,
};

export const useAiStore = create<AiState>((set) => ({
  ...initial,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openAsk: (askRepoId) => set({ askRepoId }),
  closeAsk: () => set({ askRepoId: null }),
  openPrDescription: (prTarget) => set({ prTarget }),
  closePrDescription: () => set({ prTarget: null }),
  ackPreview: () => set({ previewAcked: true }),
  reset: () => set(initial),
}));

export const openAiSettings = () => useAiStore.getState().openSettings();
export const openAskAi = (repoId: string) => useAiStore.getState().openAsk(repoId);
export const openPrDescription = (target: PrDescriptionTarget) =>
  useAiStore.getState().openPrDescription(target);
