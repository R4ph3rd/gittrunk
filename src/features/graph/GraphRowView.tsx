import { memo, useMemo, useRef, type MouseEvent } from "react";
import { EllipsisVertical } from "lucide-react";
import { IconButton } from "@/design/components";
import { useLongPress } from "@/design/hooks";
import type { GraphRow, RefLabel } from "@/ipc/bindings";
import { cn } from "@/lib/cn";
import type { ActionTarget } from "@/features/operations/actions/types";
import { dndStateClass, useDndNode } from "@/features/operations/dnd/useDndNode";
import type { DragSource, DropTarget } from "@/features/operations/dnd/types";
import { CommitHoverCard } from "./CommitHoverCard";
import { absoluteDate, relativeDate } from "./format";
import { REFS_COLUMN_WIDTH, ROW_HEIGHT } from "./layout";
import { RefBadge } from "./RefBadge";

const MAX_DESKTOP_BADGES = 2;

export { RefBadge };

const KIND_RANK: Record<RefLabel["kind"], number> = {
  localBranch: 1,
  remoteBranch: 2,
  tag: 3,
  stash: 4,
};

/** HEAD's branch first, then local branches, remote branches and tags. */
function sortRefs(refs: readonly RefLabel[]): RefLabel[] {
  const rank = (l: RefLabel) => (l.isHead && l.kind === "localBranch" ? 0 : KIND_RANK[l.kind]);
  return [...refs].sort((x, y) => rank(x) - rank(y));
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
      color={row.color}
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
  /** Desktop only: the hover card of this row is open. */
  cardOpen?: boolean;
  onCardOpenChange?: (index: number, open: boolean) => void;
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
  cardOpen = false,
  onCardOpenChange,
}: Props & { rowHeight: number }) {
  const sorted = useMemo(() => (row ? sortRefs(row.refs) : []), [row]);
  const badges = sorted.slice(0, MAX_DESKTOP_BADGES);
  const hidden = sorted.slice(MAX_DESKTOP_BADGES);
  const commit = row
    ? ({ kind: "commit", oid: row.oid, shortOid: row.shortOid, index: row.index } as const)
    : undefined;
  const {
    setNodeRef,
    dragProps,
    state: dndState,
  } = useDndNode({ id: `row:${index}`, repoId, source: commit, target: commit });
  const el = (
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
        "absolute left-0 flex w-full items-center pr-3 text-sm",
        selected ? "bg-accent-muted" : "hover:bg-surface-hover",
        dndState && dndStateClass[dndState],
      )}
      style={{ top, height: rowHeight }}
    >
      {row && (
        <>
          <div
            role="gridcell"
            data-testid="refs-cell"
            className="flex shrink-0 items-center justify-end gap-1 overflow-hidden pr-1"
            style={{ width: REFS_COLUMN_WIDTH }}
          >
            {badges.map((l) => (
              <GraphRefBadge key={l.fullName} repoId={repoId} row={row} label={l} onMenu={onMenu} />
            ))}
            {hidden.length > 0 && (
              <span
                className="shrink-0 text-xs text-fg-subtle"
                title={hidden.map((l) => l.name).join("\n")}
              >
                +{hidden.length}
              </span>
            )}
          </div>
          <div aria-hidden className="shrink-0" style={{ width: gutter }} />
          <div role="gridcell" className="min-w-0 flex-1 truncate pl-2">
            {row.summary}
          </div>
          <div role="gridcell" className="sr-only">
            {row.authorName}, {relativeDate(row.authorTime)}, {row.shortOid}
          </div>
        </>
      )}
    </div>
  );
  if (!row || !onCardOpenChange) return el;
  return (
    <CommitHoverCard
      repoId={repoId}
      row={row}
      open={cardOpen}
      onOpenChange={(o) => onCardOpenChange(index, o)}
    >
      {el}
    </CommitHoverCard>
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
