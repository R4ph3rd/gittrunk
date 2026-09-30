import { useDndStore } from "@/stores/dnd";
import { buildActionEntries, type ActionContext } from "./entries";
import type { ActionTarget } from "./types";

/** Opens the shared action menu for a commit, branch or tag at a viewport point. */
export function openActionMenu(x: number, y: number, target: ActionTarget, ctx: ActionContext) {
  const title = target.kind === "commit" ? target.shortOid : target.name;
  useDndStore.getState().openMenu({ x, y, title, entries: buildActionEntries(target, ctx) });
}
