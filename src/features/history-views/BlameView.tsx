import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { relativeDate } from "@/features/graph/format";
import type { BlameHunk } from "@/ipc/bindings";
import { cn } from "@/lib/cn";
import { groupBlame } from "./blameGroups";
import { useBlame } from "./queries";

const LINE_HEIGHT = 20;

/** Blame for one file: virtualized lines with a per-hunk gutter. Clicking a hunk reveals its commit. */
export function BlameView({
  repoId,
  path,
  rev,
  onReveal,
}: {
  repoId: string;
  path: string;
  rev: string | null;
  onReveal: (oid: string) => void;
}) {
  const blame = useBlame(repoId, path, rev);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => (blame.data ? groupBlame(blame.data.lines, blame.data.hunks) : []),
    [blame.data],
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is used as documented
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20,
    initialRect: { width: 900, height: 500 },
  });

  if (blame.isError) return <p className="p-3 text-sm text-danger">{blame.error.message}</p>;
  if (!blame.data) return <p className="p-3 text-sm text-fg-muted">Loading blame…</p>;
  const hunks = blame.data.hunks;

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={`Blame for ${path}`}
      tabIndex={0}
      data-testid="blame-lines"
      className="h-full overflow-auto font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", minWidth: "100%" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          const hunk: BlameHunk | undefined = hunks[row.hunkIndex];
          const alternate = row.hunkIndex % 2 === 1;
          return (
            <div
              key={item.index}
              data-line={item.index + 1}
              data-hunk={row.hunkIndex}
              style={{ top: item.start, height: LINE_HEIGHT }}
              className={cn(
                "absolute flex w-full leading-5",
                alternate ? "bg-bg-subtle" : "bg-surface",
                row.first && "border-t border-border",
              )}
            >
              <div
                onClick={() => hunk && onReveal(hunk.oid)}
                className={cn(
                  "flex w-[26rem] shrink-0 items-center gap-2 border-r border-border px-2",
                  hunk && "cursor-pointer hover:bg-surface-hover",
                )}
              >
                {row.first && hunk && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReveal(hunk.oid);
                    }}
                    title={`${hunk.summary} (${hunk.oid.slice(0, 7)}) - reveal in graph`}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-fg-muted hover:text-fg"
                  >
                    <span className="w-24 shrink-0 truncate text-fg">{hunk.authorName}</span>
                    <span className="w-16 shrink-0 truncate text-fg-subtle">
                      {relativeDate(hunk.authorTime)}
                    </span>
                    <span className="shrink-0 text-accent">{hunk.oid.slice(0, 7)}</span>
                    <span className="truncate">{hunk.summary}</span>
                  </button>
                )}
              </div>
              <span className="w-12 shrink-0 select-none pr-2 text-right text-fg-subtle">
                {item.index + 1}
              </span>
              <span className="whitespace-pre pr-4">{row.line}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
