import { useCallback, type HTMLAttributes } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useLayout } from "@/app/layout/useLayout";
import { usePlatform } from "@/app/platform";
import { useDndStore } from "@/stores/dnd";
import { resolveDrop } from "./resolve";
import type { DragData, DragSource, DropData, DropTarget } from "./types";

export interface DndNodeConfig {
  /** Unique among all nodes on the page. */
  id: string;
  repoId: string;
  source?: DragSource;
  target?: DropTarget;
  /** Also start drags from the keyboard (Space). Off for graph rows, which use grid navigation. */
  keyboard?: boolean;
}

/** How a node looks during a drag: hovered valid target, other valid target, or not a target. */
export type DndState = "over" | "valid" | "invalid" | null;

/** Class names for the drag states, shared by rows, labels and sidebar items. */
export const dndStateClass: Record<Exclude<DndState, null>, string> = {
  over: "bg-accent-muted ring-1 ring-inset ring-accent",
  valid: "ring-1 ring-inset ring-border-strong",
  invalid: "opacity-40",
};

/**
 * Makes an element a draggable and/or droppable. Spread `dragProps` on the element and pass
 * `setNodeRef` as its ref. Subscribes to the drag store only, so a drag never re-renders the tree.
 */
export function useDndNode(inputConfig: DndNodeConfig | undefined) {
  // Drag and drop is not offered on compact layouts (the action menus carry the same operations)
  // nor on read-only platforms: the node stays a plain element.
  const { isCompact } = useLayout();
  const { readOnly } = usePlatform();
  const config = isCompact || readOnly ? undefined : inputConfig;
  const id = config?.id ?? "none";
  const repoId = config?.repoId ?? "";
  const drag = useDraggable({
    id: `drag:${id}`,
    data: { repoId, source: config?.source } as Partial<DragData>,
    disabled: !config?.source,
  });
  const drop = useDroppable({
    id: `drop:${id}`,
    data: { repoId, target: config?.target } as Partial<DropData>,
    disabled: !config?.target,
  });
  const active = useDndStore((s) => s.drag);
  const { setNodeRef: setDragRef } = drag;
  const { setNodeRef: setDropRef } = drop;
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  let state: DndState = null;
  if (active && config?.target && active.repoId === repoId) {
    const valid = resolveDrop(active.source, config.target, active.ctx).length > 0;
    state = valid ? (drop.isOver ? "over" : "valid") : "invalid";
  }

  const dragProps = (
    !config?.source
      ? {}
      : config.keyboard
        ? { ...drag.attributes, ...drag.listeners }
        : { onPointerDown: drag.listeners?.onPointerDown }
  ) as HTMLAttributes<HTMLElement>;

  return { setNodeRef, dragProps, state, isDragging: drag.isDragging };
}
