import { memo, type HTMLAttributes, type MouseEvent, type Ref } from "react";
import type { GraphRow, RefLabel } from "@/ipc/bindings";
import { cn } from "@/lib/cn";
import type { ActionTarget } from "@/features/operations/actions/types";
import { dndStateClass, useDndNode } from "@/features/operations/dnd/useDndNode";
import type { DragSource, DropTarget } from "@/features/operations/dnd/types";
import { absoluteDate, relativeDate } from "./format";
import { ROW_HEIGHT } from "./layout";

const MAX_BADGES = 3;

export function RefBadge({
  label,
  className,
  ref,
  ...rest
}: {
  label: RefLabel;
  ref?: Ref<HTMLSpanElement>;
} & HTMLAttributes<HTMLSpanElement>) {
  const tone =
    label.kind === "tag"
      ? "border-warning/40 text-warning"
      : label.kind === "remoteBranch"
        ? "border-border-strong text-fg-muted"
        : label.kind === "stash"
          ? "border-border-strong text-fg-subtle"
          : "border-accent/40 bg-accent-muted text-accent";
  return (
    <span
      {...rest}
      ref={ref}
      data-kind={label.kind}
      data-head={label.isHead || undefined}
      title={label.fullName}
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-sm border px-1.5 font-mono text-xs leading-none",
        tone,
        label.isHead && "border-accent bg-accent font-semibold text-accent-fg",
        className,
      )}
    >
      {label.name}
    </span>
  );
}

export type OpenMenu = (e: MouseEvent, target: ActionTarget) => void;

function refSource(label: RefLabel, oid: string): DragSource | undefined {
  if (label.kind === "localBranch" || label.kind === "remoteBranch") {
    return {
      kind: "branch",
      name: label.name,
      fullName: label.fullName,
      remote: label.kind === "remoteBranch",
      isHead: label.isHead,
      oid,
    };
  }
  if (label.kind === "tag") {
    return { kind: "tag", name: label.name, fullName: label.fullName, oid };
  }
  return undefined;
}

/** A branch or tag label: draggable, and (for branches) a drop target. */
function GraphRefBadge({
  repoId,
  row,
  label,
  onMenu,
}: {
  repoId: string;
  row: GraphRow;
  label: RefLabel;
  onMenu: OpenMenu;
}) {
  const source = refSource(label, row.oid);
  const target: DropTarget | undefined =
    source?.kind === "branch" ? { ...source, kind: "branch" } : undefined;
  const {
    setNodeRef,
    dragProps,
    state: dndState,
    isDragging,
  } = useDndNode({ id: `label:${row.index}:${label.fullName}`, repoId, source, target });
  return (
    <RefBadge
      label={label}
      ref={setNodeRef}
      {...dragProps}
      className={cn(
        source && "cursor-grab",
        dndState && dndStateClass[dndState],
        isDragging && "opacity-50",
      )}
      onContextMenu={
        source
          ? (e) => {
              e.stopPropagation();
              onMenu(
                e,
                source.kind === "branch"
                  ? source
                  : { kind: "tag", name: label.name, oid: source.oid },
              );
            }
          : undefined
      }
    />
  );
}

interface Props {
  repoId: string;
  index: number;
  row: GraphRow | undefined;
  top: number;
  gutter: number;
  selected: boolean;
  onSelect: (index: number) => void;
  onMenu: OpenMenu;
}

function GraphRowViewImpl({ repoId, index, row, top, gutter, selected, onSelect, onMenu }: Props) {
  const badges = row?.refs.slice(0, MAX_BADGES) ?? [];
  const extra = row ? row.refs.length - badges.length : 0;
  const commit = row
    ? ({ kind: "commit", oid: row.oid, shortOid: row.shortOid, index: row.index } as const)
    : undefined;
  const {
    setNodeRef,
    dragProps,
    state: dndState,
  } = useDndNode({ id: `row:${index}`, repoId, source: commit, target: commit });
  return (
    <div
      {...dragProps}
      ref={setNodeRef}
      role="row"
      id={`graph-row-${index}`}
      aria-rowindex={index + 1}
      aria-selected={selected}
      data-index={index}
      onClick={() => onSelect(index)}
      onContextMenu={
        row ? (e) => onMenu(e, { kind: "commit", oid: row.oid, shortOid: row.shortOid }) : undefined
      }
      className={cn(
        "absolute left-0 flex w-full items-center gap-3 pr-3 text-sm",
        selected ? "bg-accent-muted" : "hover:bg-surface-hover",
        dndState && dndStateClass[dndState],
      )}
      style={{ top, height: ROW_HEIGHT, paddingLeft: gutter }}
    >
      {row && (
        <>
          <div role="gridcell" className="flex min-w-0 flex-1 items-center gap-1.5">
            {badges.map((l) => (
              <GraphRefBadge key={l.fullName} repoId={repoId} row={row} label={l} onMenu={onMenu} />
            ))}
            {extra > 0 && <span className="shrink-0 text-xs text-fg-subtle">+{extra}</span>}
            <span className="truncate">{row.summary}</span>
          </div>
          <div role="gridcell" className="w-32 shrink-0 truncate text-fg-muted">
            {row.authorName}
          </div>
          <div
            role="gridcell"
            className="w-16 shrink-0 text-right text-fg-muted"
            title={absoluteDate(row.authorTime)}
          >
            {relativeDate(row.authorTime)}
          </div>
          <div role="gridcell" className="w-16 shrink-0 font-mono text-xs text-fg-subtle">
            {row.shortOid}
          </div>
        </>
      )}
    </div>
  );
}

export const GraphRowView = memo(GraphRowViewImpl);
