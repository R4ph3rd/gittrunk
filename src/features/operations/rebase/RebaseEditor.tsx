/* eslint-disable react-hooks/refs -- false positive: dnd-kit `useSortable` returns ref callbacks and props, not ref values */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, CornerRightUp, GripVertical } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Spinner,
  Textarea,
  toast,
} from "@/design/components";
import { NativeSelect } from "@/features/remotes/NativeSelect";
import { errorMessage, useOutcomeToast } from "@/features/staging/ops";
import type { OpPreview, RebaseAction } from "@/ipc/bindings";
import { cn } from "@/lib/cn";
import { useCommitMessages, useRebaseInteractive, useRebaseTodo } from "../queries";
import {
  ACTIONS,
  ACTION_KEYS,
  buildTodo,
  effectiveMessage,
  moveItem,
  toEditorItems,
  validateTodo,
  type EditorItem,
} from "./todo";

const short = (oid: string) => oid.slice(0, 7);

interface RowProps {
  item: EditorItem;
  index: number;
  count: number;
  message: string | null;
  onAction: (action: RebaseAction) => void;
  onMove: (delta: number) => void;
  onMessage: (message: string) => void;
}

function Row({ item, index, count, message, onAction, onMove, onMessage }: RowProps) {
  const sortable = useSortable({ id: item.oid });
  const dropped = item.action === "drop";

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      onMove(e.key === "ArrowUp" ? -1 : 1);
    } else if (!e.altKey && !e.ctrlKey && !e.metaKey) {
      const action = ACTION_KEYS[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        onAction(action);
      }
    }
  };

  return (
    <li
      ref={sortable.setNodeRef}
      id={`rebase-row-${item.oid}`}
      tabIndex={0}
      aria-label={`${item.action} ${short(item.oid)} ${item.summary}`}
      data-action={item.action}
      onKeyDown={onKeyDown}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        "flex flex-col gap-1 rounded-md border border-border bg-surface px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
        sortable.isDragging && "z-10 opacity-80 shadow-md",
      )}
    >
      <div className="flex items-center gap-2">
        <IconButton
          size="sm"
          aria-label={`Drag to reorder ${item.summary}`}
          ref={sortable.setActivatorNodeRef}
          className="cursor-grab touch-none"
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical />
        </IconButton>
        <NativeSelect
          aria-label={`Action for ${short(item.oid)}`}
          value={item.action}
          className="w-24 shrink-0"
          onChange={(e) => onAction(e.target.value as RebaseAction)}
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </NativeSelect>
        <span className="shrink-0 font-mono text-xs text-fg-subtle">{short(item.oid)}</span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            dropped && "text-fg-subtle line-through",
          )}
          title={item.summary}
        >
          {item.summary}
        </span>
        <Button
          size="xs"
          variant="ghost"
          disabled={index === 0 || item.action === "squash"}
          onClick={() => onAction("squash")}
          aria-label={`Squash ${short(item.oid)} into previous`}
        >
          <CornerRightUp />
          Squash into previous
        </Button>
        <IconButton
          size="sm"
          aria-label={`Move ${short(item.oid)} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={`Move ${short(item.oid)} down`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </IconButton>
      </div>
      {message !== null && (
        <Textarea
          aria-label={`Message for ${short(item.oid)}`}
          value={message}
          rows={3}
          className="font-mono text-sm"
          onChange={(e) => onMessage(e.target.value)}
        />
      )}
    </li>
  );
}

function PreviewBox({ preview }: { preview: OpPreview }) {
  return (
    <div
      data-testid="rebase-preview"
      className="rounded-md border border-border bg-bg-subtle p-2 text-sm"
    >
      <p className="font-medium">{preview.summary}</p>
      <p className="text-fg-muted">{preview.commitsCreated} commit(s) will be created.</p>
      {preview.commitsDropped.length > 0 && (
        <div>
          <p className="text-fg-muted">Dropped:</p>
          <ul>
            {preview.commitsDropped.map((c) => (
              <li key={c.oid} className="truncate font-mono text-xs">
                {short(c.oid)} {c.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.predictedConflicts.length > 0 && (
        <div className="text-warning">
          <p>Predicted conflicts:</p>
          <ul>
            {preview.predictedConflicts.map((p) => (
              <li key={p} className="font-mono text-xs">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.warnings.map((w) => (
        <p key={w} className="text-warning">
          {w}
        </p>
      ))}
    </div>
  );
}

function EditorBody({
  repoId,
  base,
  initial,
  onClose,
}: {
  repoId: string;
  base: string;
  initial: EditorItem[];
  onClose: () => void;
}) {
  const [items, setItems] = useState(initial);
  const [preview, setPreview] = useState<OpPreview | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const { messages, ready } = useCommitMessages(
    repoId,
    initial.map((i) => i.oid),
  );
  const rebase = useRebaseInteractive(repoId);
  const notify = useOutcomeToast(repoId);
  const focusOid = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Keep keyboard focus on a row after it moved (the DOM node is re-inserted).
  useEffect(() => {
    if (focusOid.current) {
      document.getElementById(`rebase-row-${focusOid.current}`)?.focus();
      focusOid.current = null;
    }
  }, [items]);

  const errors = validateTodo(items, messages);
  const change = (next: EditorItem[]) => {
    setItems(next);
    setPreview(null);
    setBackendError(null);
  };
  const move = (from: number, to: number) => {
    focusOid.current = items[from]?.oid ?? null;
    change(moveItem(items, from, to));
  };
  const setAction = (i: number, action: RebaseAction) => {
    change(
      items.map((it, k) =>
        k === i ? { ...it, action, message: action === it.action ? it.message : null } : it,
      ),
    );
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(
      items.findIndex((i) => i.oid === e.active.id),
      items.findIndex((i) => i.oid === e.over!.id),
    );
  };

  const request = () => ({ base, todo: buildTodo(items, messages) });

  const run = async (dryRun: boolean) => {
    setShowErrors(true);
    if (errors.length > 0) return;
    setBackendError(null);
    try {
      const outcome = await rebase.mutateAsync({ request: request(), dryRun });
      if (outcome.kind === "preview") {
        setPreview(outcome.preview);
      } else if (outcome.kind === "conflicted") {
        toast.warning(`Rebase stopped with conflicts in ${outcome.files.length} file(s)`);
        onClose();
      } else {
        notify(outcome, "Rebase complete");
        const edit = items.find((i) => i.action === "edit");
        if (edit) {
          toast.info(
            `Stopped to edit ${short(edit.oid)}: amend the commit, then choose Continue in the banner.`,
          );
        }
        onClose();
      }
    } catch (e) {
      setBackendError(errorMessage(e));
    }
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.oid)} strategy={verticalListSortingStrategy}>
          <ol
            aria-label="Rebase todo"
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
          >
            {items.map((item, i) => (
              <Row
                key={item.oid}
                item={item}
                index={i}
                count={items.length}
                message={
                  item.action === "reword" || item.action === "squash"
                    ? (effectiveMessage(items, i, messages) ?? "")
                    : null
                }
                onAction={(a) => setAction(i, a)}
                onMove={(d) => move(i, i + d)}
                onMessage={(m) =>
                  change(items.map((it, k) => (k === i ? { ...it, message: m } : it)))
                }
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {showErrors && errors.length > 0 && (
        <ul role="alert" className="text-sm text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {backendError && (
        <p role="alert" className="text-sm text-danger">
          {backendError}
        </p>
      )}
      {preview && <PreviewBox preview={preview} />}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!ready || rebase.isPending} onClick={() => void run(true)}>
          Preview
        </Button>
        <Button
          variant="primary"
          disabled={!ready || rebase.isPending}
          onClick={() => void run(false)}
        >
          Start rebase
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Interactive rebase editor. Squash affordance: a per-row "Squash into previous" button (also
 * the `s` key) that folds the row into the commit above it; rows are reordered by dragging the
 * grip, by Space + arrows on the grip (dnd-kit keyboard sensor), or Alt+Up / Alt+Down on a row.
 */
export function RebaseEditor({
  repoId,
  base,
  onClose,
}: {
  repoId: string;
  base: string;
  onClose: () => void;
}) {
  const todo = useRebaseTodo(repoId, base);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Interactive rebase</DialogTitle>
          <DialogDescription>
            Oldest commit first. Change actions (p r e s f d), reorder, then start.
          </DialogDescription>
        </DialogHeader>
        {todo.isError && (
          <p role="alert" className="text-sm text-danger">
            {todo.error.message}
          </p>
        )}
        {todo.isPending && (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        )}
        {todo.data && todo.data.length === 0 && (
          <p className="text-sm text-fg-muted">There are no commits to rebase above this base.</p>
        )}
        {todo.data && todo.data.length > 0 && (
          <EditorBody
            repoId={repoId}
            base={base}
            initial={toEditorItems(todo.data)}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
