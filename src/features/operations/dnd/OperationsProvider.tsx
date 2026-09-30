import type { ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { GitBranch, GitCommitHorizontal, Tag } from "lucide-react";
import { usePlatform } from "@/app/platform";
import { useLayout } from "@/app/layout/useLayout";
import { toast } from "@/design/components";
import { useDndStore } from "@/stores/dnd";
import { ActionMenuHost } from "../actions/ActionMenu";
import { OperationCommands } from "../actions/commands";
import { NamePromptHost } from "../actions/NamePromptDialog";
import { dropOperation } from "../actions/ops";
import type { ActionEntry } from "../actions/types";
import { OperationConfirmHost } from "../preview/ConfirmDialog";
import { requestOperation } from "../preview/useConfirmedOperation";
import { startAutoScroll } from "./autoscroll";
import { collisionDetection, keyboardCoordinates } from "./collision";
import { makeDropContext } from "./context";
import { resolveDrop } from "./resolve";
import { sourceLabel, targetLabel, type DragData, type DropData, type DragSource } from "./types";

const KEYBOARD_CODES = { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] };

const dragLabel = (data: unknown) => {
  const source = (data as Partial<DragData> | undefined)?.source;
  return source ? `${source.kind === "commit" ? "commit " : ""}${sourceLabel(source)}` : "item";
};
const dropLabel = (data: unknown) => {
  const target = (data as Partial<DropData> | undefined)?.target;
  return target ? targetLabel(target) : "target";
};

const announcements: Announcements = {
  onDragStart: ({ active }) =>
    `Picked up ${dragLabel(active.data.current)}. Use the arrow keys to choose a drop target, Enter to drop, Escape to cancel.`,
  onDragOver: ({ active, over }) => {
    const drag = useDndStore.getState().drag;
    const data = over?.data.current as Partial<DropData> | undefined;
    if (!over || !data?.target || !drag) {
      return `${dragLabel(active.data.current)} is not over a valid target.`;
    }
    const n = resolveDrop(drag.source, data.target, drag.ctx).length;
    return `Over ${dropLabel(over.data.current)}: ${n} action${n === 1 ? "" : "s"} available.`;
  },
  onDragMove: () => undefined,
  onDragEnd: ({ active, over }) =>
    over
      ? `Dropped ${dragLabel(active.data.current)} on ${dropLabel(over.data.current)}. Choose an action from the menu.`
      : `Dropped ${dragLabel(active.data.current)} outside a valid target. Nothing changed.`,
  onDragCancel: ({ active }) => `Cancelled dragging ${dragLabel(active.data.current)}.`,
};

function DragChip({ source }: { source: DragSource }) {
  const Icon =
    source.kind === "commit" ? GitCommitHorizontal : source.kind === "tag" ? Tag : GitBranch;
  return (
    <div className="pointer-events-none inline-flex h-6 items-center gap-1.5 rounded-md border border-accent bg-surface-raised px-2 font-mono text-xs text-fg shadow-md">
      <Icon className="size-3 text-accent" aria-hidden />
      {sourceLabel(source)}
    </div>
  );
}

function pointerAt(event: DragEndEvent): { x: number; y: number } {
  const ev = event.activatorEvent;
  if ("clientX" in ev && typeof ev.clientX === "number" && "clientY" in ev) {
    return { x: ev.clientX + event.delta.x, y: (ev.clientY as number) + event.delta.y };
  }
  const rect = event.over?.rect;
  return rect ? { x: rect.left + 24, y: rect.top + rect.height } : { x: 0, y: 0 };
}

let stopAutoScroll: (() => void) | null = null;

/**
 * Drag and drop for the commit graph and the branch list, plus the shared hosts for the drop menu,
 * confirmation dialog, name prompts and palette commands. Wrap the repository view with it.
 */
export function OperationsProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const drag = useDndStore((s) => s.drag);
  // Subscribing re-renders DndContext when the keyboard cursor moves, which re-runs collision detection.
  useDndStore((s) => s.cursor);
  const { isCompact } = useLayout();
  const platform = usePlatform();
  const pointer = useSensor(PointerSensor, { activationConstraint: { distance: 6 } });
  const keyboard = useSensor(KeyboardSensor, {
    coordinateGetter: keyboardCoordinates,
    keyboardCodes: KEYBOARD_CODES,
  });
  // No sensors on compact layouts: drag and drop is replaced by the action sheets.
  const sensors = useSensors(...(isCompact ? [] : [pointer, keyboard]));

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as Partial<DragData> | undefined;
    if (!data?.source || !data.repoId) return;
    const ctx = makeDropContext(client, data.repoId, data.source);
    useDndStore.getState().startDrag({ repoId: data.repoId, source: data.source, ctx });
    stopAutoScroll?.();
    stopAutoScroll = startAutoScroll();
  };

  const finish = () => {
    stopAutoScroll?.();
    stopAutoScroll = null;
    useDndStore.getState().endDrag();
  };

  const onDragEnd = (event: DragEndEvent) => {
    const active = useDndStore.getState().drag;
    finish();
    const drop = event.over?.data.current as Partial<DropData> | undefined;
    if (!active || !drop?.target) return;
    const options = resolveDrop(active.source, drop.target, active.ctx).filter(
      (o) =>
        !(o.id === "rebase" && !platform.supportsRebase) &&
        !(o.id === "interactiveRebase" && !platform.supportsInteractiveRebase),
    );
    if (options.length === 0) {
      toast.info("Nothing to do for that drop");
      return;
    }
    const repoId = active.repoId;
    const entries: ActionEntry[] = options.map((option) => ({
      kind: "item",
      id: option.id,
      label: option.label,
      destructive: option.destructive && option.action.type === "reset",
      run: () => {
        const op = dropOperation(repoId, option);
        if ("spec" in op) void requestOperation(client, op.spec);
        else op.dispatch();
      },
    }));
    useDndStore.getState().openMenu({
      ...pointerAt(event),
      title: `${sourceLabel(active.source)} onto ${targetLabel(drop.target)}`,
      entries,
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      autoScroll={false}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To pick up, press Space. Use the arrow keys to move between valid drop targets, then Enter to drop or Escape to cancel. Every action is also in the context menu and the command palette.",
        },
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {drag ? <DragChip source={drag.source} /> : null}
      </DragOverlay>
      <ActionMenuHost />
      <OperationConfirmHost />
      <NamePromptHost />
      <OperationCommands />
    </DndContext>
  );
}
