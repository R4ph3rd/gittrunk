import { create } from "zustand";
import type {
  ActionEntry,
  OperationSpec,
  PromptRequest,
} from "@/features/operations/actions/types";
import type { DragSource, DropContext } from "@/features/operations/dnd/types";
import type { OpPreview } from "@/ipc/bindings";

export interface MenuState {
  x: number;
  y: number;
  title: string;
  entries: ActionEntry[];
}

export interface PendingConfirm {
  spec: OperationSpec;
  preview: OpPreview;
}

export interface ActiveDrag {
  repoId: string;
  source: DragSource;
  ctx: DropContext;
}

interface DndState {
  /** Drop and context menus share one host, anchored at a viewport point. */
  menu: MenuState | null;
  confirm: PendingConfirm | null;
  prompt: PromptRequest | null;
  /** The drag in flight; rows subscribe to it to highlight valid targets and dim invalid ones. */
  drag: ActiveDrag | null;
  /** Keyboard drags: index into the ordered list of valid targets (-1 = none yet). */
  cursor: number;
  openMenu: (menu: MenuState) => void;
  closeMenu: () => void;
  setConfirm: (confirm: PendingConfirm | null) => void;
  setPrompt: (prompt: PromptRequest | null) => void;
  startDrag: (drag: ActiveDrag) => void;
  endDrag: () => void;
  setCursor: (cursor: number) => void;
}

export const useDndStore = create<DndState>((set) => ({
  menu: null,
  confirm: null,
  prompt: null,
  drag: null,
  cursor: -1,
  openMenu: (menu) => set({ menu }),
  closeMenu: () => set({ menu: null }),
  setConfirm: (confirm) => set({ confirm }),
  setPrompt: (prompt) => set({ prompt }),
  startDrag: (drag) => set({ drag, cursor: -1 }),
  endDrag: () => set({ drag: null, cursor: -1 }),
  setCursor: (cursor) => set({ cursor }),
}));
