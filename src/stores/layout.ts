import { create } from "zustand";

export type PanelId = "sidebar" | "bottom" | "right";
export interface PanelVisibility {
  sidebar: boolean;
  bottom: boolean;
  right: boolean;
}

export const DEFAULT_LAYOUT: PanelVisibility = { sidebar: true, bottom: false, right: true };
export const LAYOUT_STORAGE_KEY = "gittrunk.layout.v1";

interface LayoutState extends PanelVisibility {
  toggle(panel: PanelId): void;
  setVisible(panel: PanelId, visible: boolean): void;
  /** Defaults and cleared storage (tests). */
  reset(): void;
}

function read(): PanelVisibility {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_LAYOUT };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_LAYOUT };
    const obj = parsed as Record<string, unknown>;
    const pick = (k: PanelId): boolean => {
      const v = obj[k];
      return typeof v === "boolean" ? v : DEFAULT_LAYOUT[k];
    };
    return { sidebar: pick("sidebar"), bottom: pick("bottom"), right: pick("right") };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function write(v: PanelVisibility) {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable: the layout still works for this session */
  }
}

export const useLayoutStore = create<LayoutState>((set, get) => {
  const persist = (patch: Partial<PanelVisibility>) => {
    set(patch);
    const { sidebar, bottom, right } = get();
    write({ sidebar, bottom, right });
  };
  return {
    ...read(),
    toggle: (panel) => persist({ [panel]: !get()[panel] }),
    setVisible: (panel, visible) => persist({ [panel]: visible }),
    reset: () => {
      try {
        window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
      } catch {
        /* storage unavailable */
      }
      set({ ...DEFAULT_LAYOUT });
    },
  };
});
