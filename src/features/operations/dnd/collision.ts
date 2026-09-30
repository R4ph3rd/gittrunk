import type {
  CollisionDetection,
  DroppableContainer,
  KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { useDndStore } from "@/stores/dnd";
import { resolveDrop } from "./resolve";
import type { DropData } from "./types";

/** Droppables that accept the drag in flight (a drop there offers at least one operation). */
function validContainers(containers: DroppableContainer[]): DroppableContainer[] {
  const drag = useDndStore.getState().drag;
  if (!drag) return [];
  return containers.filter((c) => {
    if (c.disabled) return false;
    const data = c.data.current as DropData | undefined;
    return (
      data !== undefined &&
      data.repoId === drag.repoId &&
      resolveDrop(drag.source, data.target, drag.ctx).length > 0
    );
  });
}

/** Valid targets in document order: the sequence keyboard drags step through. */
function orderedValid(containers: DroppableContainer[]): DroppableContainer[] {
  return validContainers(containers).sort((a, b) => {
    const na = a.node.current;
    const nb = b.node.current;
    if (!na || !nb || na === nb) return 0;
    return na.compareDocumentPosition(nb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

/**
 * Pointer drags: the smallest valid droppable under the pointer (a branch label wins over its
 * row). Rects are read live because the graph scrolls while dragging. Keyboard drags (no pointer):
 * the target the arrow keys selected.
 */
export const collisionDetection: CollisionDetection = ({
  droppableContainers,
  pointerCoordinates,
}) => {
  if (!pointerCoordinates) {
    const picked = orderedValid(droppableContainers)[useDndStore.getState().cursor];
    return picked ? [{ id: picked.id, data: { droppableContainer: picked, value: 0 } }] : [];
  }
  const { x, y } = pointerCoordinates;
  const hits: Array<{ container: DroppableContainer; area: number }> = [];
  for (const container of validContainers(droppableContainers)) {
    const rect = container.node.current?.getBoundingClientRect();
    if (!rect) continue;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      hits.push({ container, area: rect.width * rect.height });
    }
  }
  hits.sort((a, b) => a.area - b.area);
  return hits.map(({ container, area }) => ({
    id: container.id,
    data: { droppableContainer: container, value: area },
  }));
};

/** Arrow keys move between valid drop targets instead of moving the dragged element by pixels. */
export const keyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  const dir =
    event.code === "ArrowDown" || event.code === "ArrowRight"
      ? 1
      : event.code === "ArrowUp" || event.code === "ArrowLeft"
        ? -1
        : 0;
  if (dir === 0) return undefined;
  const targets = orderedValid(context.droppableContainers.getEnabled());
  if (targets.length === 0) return currentCoordinates;
  const { cursor, setCursor } = useDndStore.getState();
  const next =
    cursor < 0
      ? dir === 1
        ? 0
        : targets.length - 1
      : (cursor + dir + targets.length) % targets.length;
  setCursor(next);
  targets[next]?.node.current?.scrollIntoView?.({ block: "nearest" });
  return currentCoordinates;
};
