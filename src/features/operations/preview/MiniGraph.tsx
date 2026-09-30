import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CommitSummary, RefUpdate } from "@/ipc/bindings";
import { buildMiniGraph, type MiniNode, type MiniNodeKind } from "./miniGraph";
import { cachedRows } from "./rows";

const STEP = 22;
const HEADER = 20;
const COLUMN = 190;
const DOT_X = 12;

const dotClass: Record<MiniNodeKind, string> = {
  existing: "fill-fg-muted",
  created: "fill-accent",
  dropped: "fill-danger",
};

function Column({
  title,
  nodes,
  hidden,
  x,
}: {
  title: string;
  nodes: MiniNode[];
  hidden: number;
  x: number;
}) {
  return (
    <g transform={`translate(${x} 0)`} data-testid={`mini-graph-${title.toLowerCase()}`}>
      <text y={12} className="fill-fg-subtle text-[10px] uppercase tracking-wide">
        {title}
      </text>
      {nodes.length > 1 && (
        <line
          x1={DOT_X}
          x2={DOT_X}
          y1={HEADER + STEP / 2}
          y2={HEADER + (nodes.length - 1) * STEP + STEP / 2}
          className="stroke-border-strong"
          strokeWidth={2}
        />
      )}
      {nodes.map((n, i) => (
        <g key={n.oid} transform={`translate(0 ${HEADER + i * STEP + STEP / 2})`}>
          <circle r={4.5} cx={DOT_X} className={dotClass[n.kind]} data-kind={n.kind} />
          <text x={DOT_X + 12} y={4} className="fill-fg-subtle font-mono text-[10px]">
            {n.short}
          </text>
          {n.refs.length > 0 && (
            <text x={DOT_X + 62} y={4} className="fill-fg font-mono text-[11px] font-semibold">
              {n.refs.join(", ")}
            </text>
          )}
        </g>
      ))}
      {hidden > 0 && (
        <text
          x={DOT_X - 4}
          y={HEADER + nodes.length * STEP + 10}
          className="fill-fg-subtle text-[10px]"
        >
          +{hidden} more
        </text>
      )}
    </g>
  );
}

/** Small before/after diagram of the refs an operation moves. */
export function MiniGraph({
  repoId,
  updates,
  dropped,
}: {
  repoId: string;
  updates: RefUpdate[];
  dropped: CommitSummary[];
}) {
  const client = useQueryClient();
  const model = useMemo(
    () => buildMiniGraph(updates, dropped, cachedRows(client, repoId)),
    [client, repoId, updates, dropped],
  );
  if (model.before.length === 0 && model.after.length === 0) return null;
  const rows = Math.max(model.before.length, model.after.length, 1);
  const height = HEADER + rows * STEP + 14;
  return (
    <svg
      role="img"
      aria-label="Before and after graph"
      data-testid="mini-graph"
      viewBox={`0 0 ${COLUMN * 2} ${height}`}
      width="100%"
      height={height}
      className="mt-3 rounded-md border border-border bg-bg-subtle"
    >
      <Column title="Before" nodes={model.before} hidden={model.hiddenBefore} x={8} />
      <text x={COLUMN - 4} y={HEADER + STEP} className="fill-fg-subtle text-xs">
        {"→"}
      </text>
      <Column title="After" nodes={model.after} hidden={model.hiddenAfter} x={COLUMN + 8} />
    </svg>
  );
}
