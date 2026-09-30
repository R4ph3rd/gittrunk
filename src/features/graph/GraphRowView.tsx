import { memo, useRef, type HTMLAttributes, type MouseEvent, type Ref } from "react";
import { EllipsisVertical } from "lucide-react";
import { IconButton } from "@/design/components";
import { useLongPress } from "@/design/hooks";
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
  /** Two-line touch layout (compact layouts). */
  compact?: boolean;
  /** Row height in px; the desktop value by default. */
  rowHeight?: number;
  /** Compact only: long-press and the overflow button open the commit action sheet. */
  onCompactMenu?: (row: GraphRow) => void;
}

const MAX_COMPACT_BADGES = 2;

function CompactRow({
  index,
  row,
  top,
  gutter,
  selected,
  onSelect,
  rowHeight,
  onCompactMenu,
}: Props & { rowHeight: number }) {
  const fired = useRef(false);
  const press = useLongPress(
    () => {
      if (!row) return;
      fired.current = true;
      onCompactMenu?.(row);
    },
    { disabled: !row || !onCompactMenu },
  );
  const badges = row?.refs.slice(0, MAX_COMPACT_BADGES) ?? [];
  const extra = row ? row.refs.length - badges.length : 0;
  return (
    <div
      {...press}
      onPointerDown={(e) => {
        fired.current = false;
        press.onPointerDown(e);
      }}
      role="row"
      id={`graph-row-${index}`}
      aria-rowindex={index + 1}
      aria-selected={selected}
      data-index={index}
      data-compact=""
      onClick={() => {
        if (fired.current) {
          fired.current = false;
          return;
        }
        onSelect(index);
      }}
      className={cn(
        "absolute left-0 flex w-full touch-pan-y items-center gap-1 pr-1 text-left active:bg-surface-hover",
        selected && "bg-accent-muted",
      )}
      style={{ top, height: rowHeight, paddingLeft: gutter }}
    >
      {row && (
        <>
          <div role="gridcell" className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <span className="truncate text-base leading-tight text-fg">{row.summary}</span>
            <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-sm leading-tight text-fg-muted">
              <span className="min-w-0 shrink truncate">{row.authorName}</span>
              <span className="shrink-0" title={absoluteDate(row.authorTime)}>
                {relativeDate(row.authorTime)}
              </span>
              <span className="shrink-0 font-mono text-xs text-fg-subtle">{row.shortOid}</span>
              {badges.map((l) => (
                <RefBadge key={l.fullName} label={l} />
              ))}
              {extra > 0 && <span className="shrink-0 text-xs text-fg-subtle">+{extra}</span>}
            </span>
          </div>
          {onCompactMenu ? (
            <IconButton
              aria-label={`Actions for ${row.shortOid}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onCompactMenu(row);
              }}
            >
              <EllipsisVertical />
            </IconButton>
          ) : null}
        </>
      )}
    </div>
  );
}

function DesktopRow({
  repoId,
  index,
  row,
  top,
  gutter,
  selected,
  onSelect,
  onMenu,
  rowHeight,
}: Props & { rowHeight: number }) {
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
      style={{ top, height: rowHeight, paddingLeft: gutter }}
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

function GraphRowViewImpl(props: Props) {
  const rowHeight = props.rowHeight ?? ROW_HEIGHT;
  return props.compact ? (
    <CompactRow {...props} rowHeight={rowHeight} />
  ) : (
    <DesktopRow {...props} rowHeight={rowHeight} />
  );
}

export const GraphRowView = memo(GraphRowViewImpl);
