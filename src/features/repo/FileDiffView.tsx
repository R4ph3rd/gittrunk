import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DiffLine } from "@/ipc/bindings";
import { useFileDiff } from "@/ipc/queries";
import { cn } from "@/lib/cn";

const LINE_HEIGHT = 20;

type Flat = { kind: "header"; text: string } | { kind: "line"; line: DiffLine };

/** Plain unified diff; a full diff viewer replaces this in a later milestone. */
export function FileDiffView({ repoId, oid, path }: { repoId: string; oid: string; path: string }) {
  const diff = useFileDiff(repoId, oid, path);
  const scrollRef = useRef<HTMLDivElement>(null);
  const flat = useMemo<Flat[]>(
    () =>
      (diff.data?.hunks ?? []).flatMap((h) => [
        { kind: "header" as const, text: h.header },
        ...h.lines.map((line) => ({ kind: "line" as const, line })),
      ]),
    [diff.data],
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is used as documented
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 10,
    initialRect: { width: 400, height: 300 },
  });

  if (diff.isError) return <p className="p-3 text-sm text-danger">{diff.error.message}</p>;
  if (!diff.data) return <p className="p-3 text-sm text-fg-muted">Loading diff…</p>;
  if (diff.data.binary) return <p className="p-3 text-sm text-fg-muted">Binary file not shown.</p>;

  return (
    <div ref={scrollRef} className="h-full overflow-auto font-mono text-xs" data-testid="file-diff">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", minWidth: "100%" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const f = flat[item.index];
          if (!f) return null;
          const style = { top: item.start, height: LINE_HEIGHT };
          if (f.kind === "header") {
            return (
              <div
                key={item.index}
                style={style}
                className="absolute w-full whitespace-pre bg-bg-subtle px-2 leading-5 text-fg-subtle"
              >
                {f.text}
              </div>
            );
          }
          const { kind, content } = f.line;
          const marker = kind === "add" ? "+" : kind === "delete" ? "-" : " ";
          return (
            <div
              key={item.index}
              style={style}
              data-kind={kind}
              className={cn(
                "absolute w-full whitespace-pre px-2 leading-5",
                kind === "add" && "bg-[var(--diff-add-bg)]",
                kind === "delete" && "bg-[var(--diff-del-bg)]",
              )}
            >
              <span className="mr-2 text-fg-subtle">{marker}</span>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
