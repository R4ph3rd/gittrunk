import { create } from "zustand";

export type FileListMode = "list" | "tree";
export const FILE_LIST_MODE_KEY = "gittrunk.fileListMode";

function read(): FileListMode {
  try {
    return window.localStorage.getItem(FILE_LIST_MODE_KEY) === "tree" ? "tree" : "list";
  } catch {
    return "list";
  }
}

interface State {
  mode: FileListMode;
  /** Collapsed folders for this session, keyed `<section>:<folder path>`. */
  collapsed: ReadonlySet<string>;
  setMode(mode: FileListMode): void;
  toggleCollapsed(key: string, collapsed?: boolean): void;
}

export const useFileListMode = create<State>((set) => ({
  mode: read(),
  collapsed: new Set(),
  setMode: (mode) => {
    try {
      window.localStorage.setItem(FILE_LIST_MODE_KEY, mode);
    } catch {
      /* storage unavailable: keep the in-memory choice */
    }
    set({ mode });
  },
  toggleCollapsed: (key, collapsed) =>
    set((s) => {
      const next = new Set(s.collapsed);
      const want = collapsed ?? !next.has(key);
      if (want) next.add(key);
      else next.delete(key);
      return { collapsed: next };
    }),
}));
