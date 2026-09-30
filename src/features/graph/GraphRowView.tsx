import { memo } from "react";
import type { GraphRow, RefLabel } from "@/ipc/bindings";
import { cn } from "@/lib/cn";
import { absoluteDate, relativeDate } from "./format";
import { ROW_HEIGHT } from "./layout";

const MAX_BADGES = 3;

export function RefBadge({ label }: { label: RefLabel }) {
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
      data-kind={label.kind}
      data-head={label.isHead || undefined}
      title={label.fullName}
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-sm border px-1.5 font-mono text-xs leading-none",
        tone,
        label.isHead && "border-accent bg-accent font-semibold text-accent-fg",
      )}
    >
      {label.name}
    </span>
  );
}

interface Props {
  index: number;
  row: GraphRow | undefined;
  top: number;
  gutter: number;
  selected: boolean;
  onSelect: (index: number) => void;
}

function GraphRowViewImpl({ index, row, top, gutter, selected, onSelect }: Props) {
  const badges = row?.refs.slice(0, MAX_BADGES) ?? [];
  const extra = row ? row.refs.length - badges.length : 0;
  return (
    <div
      role="row"
      id={`graph-row-${index}`}
      aria-rowindex={index + 1}
      aria-selected={selected}
      data-index={index}
      onClick={() => onSelect(index)}
      className={cn(
        "absolute left-0 flex w-full items-center gap-3 pr-3 text-sm",
        selected ? "bg-accent-muted" : "hover:bg-surface-hover",
      )}
      style={{ top, height: ROW_HEIGHT, paddingLeft: gutter }}
    >
      {row && (
        <>
          <div role="gridcell" className="flex min-w-0 flex-1 items-center gap-1.5">
            {badges.map((l) => (
              <RefBadge key={l.fullName} label={l} />
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
