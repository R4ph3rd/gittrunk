import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/design/components";
import { relativeDate } from "@/features/graph/format";
import { FileDiffView } from "@/features/repo/FileDiffView";
import { cn } from "@/lib/cn";
import { useFileHistory } from "./queries";

/** Commits touching a file (following renames) with the selected commit's diff of that file. */
export function FileHistoryView({
  repoId,
  path,
  onReveal,
  onBlame,
}: {
  repoId: string;
  path: string;
  onReveal: (oid: string) => void;
  onBlame: (oid: string, path: string) => void;
}) {
  const history = useFileHistory(repoId, path);
  const [picked, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const entries = history.data ?? [];
  const selected = Math.min(picked, Math.max(0, entries.length - 1));
  const current = entries[selected] ?? null;

  const move = (e: KeyboardEvent, to: number) => {
    e.preventDefault();
    const next = Math.max(0, Math.min(entries.length - 1, to));
    setSelected(next);
    listRef.current?.querySelectorAll<HTMLElement>("button")[next]?.focus();
  };

  if (history.isError) return <p className="p-3 text-sm text-danger">{history.error.message}</p>;
  if (!history.data) return <p className="p-3 text-sm text-fg-muted">Loading history…</p>;
  if (entries.length === 0) {
    return <p className="p-3 text-sm text-fg-muted">No commits touch this file.</p>;
  }

  return (
    <div className="flex h-full min-h-0">
      <ul
        ref={listRef}
        aria-label={`History of ${path}`}
        className="w-[22rem] shrink-0 overflow-auto border-r border-border"
      >
        {entries.map((entry, i) => (
          <li key={entry.commit.oid}>
            <button
              type="button"
              aria-pressed={i === selected}
              onClick={() => setSelected(i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") move(e, i + 1);
                else if (e.key === "ArrowUp") move(e, i - 1);
                else if (e.key === "Home") move(e, 0);
                else if (e.key === "End") move(e, entries.length - 1);
              }}
              className={cn(
                "flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-surface-hover",
                i === selected && "bg-accent-muted",
              )}
            >
              <span className="truncate text-sm">{entry.commit.summary}</span>
              <span className="flex gap-2 text-xs text-fg-subtle">
                <span className="font-mono text-accent">{entry.commit.shortOid}</span>
                <span className="truncate">{entry.commit.authorName}</span>
                <span className="ml-auto shrink-0">{relativeDate(entry.commit.authorTime)}</span>
              </span>
              {entry.path !== path && (
                <span className="truncate font-mono text-xs text-warning">as {entry.path}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 flex-1 flex-col">
        {current && (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
                {current.path} at {current.commit.shortOid}
              </span>
              <Button size="sm" onClick={() => onBlame(current.commit.oid, current.path)}>
                Blame at this revision
              </Button>
              <Button size="sm" onClick={() => onReveal(current.commit.oid)}>
                Reveal in graph
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <FileDiffView repoId={repoId} oid={current.commit.oid} path={current.path} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
