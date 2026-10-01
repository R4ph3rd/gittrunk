import { FileClock, ScrollText } from "lucide-react";
import {
  Avatar,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  IconButton,
  Tooltip,
} from "@/design/components";
import { AiSummaryButton } from "@/features/ai";
import { openBlame, openFileHistory } from "@/features/history-views/store";
import { RefBadge } from "@/features/graph/GraphRowView";
import { absoluteDate } from "@/features/graph/format";
import { usePlatform } from "@/app/platform";
import type { Signature } from "@/ipc/bindings";
import { useAvatar, useCommitDetails } from "@/ipc/queries";
import { cn } from "@/lib/cn";
import { selectedOidOf, useRepoStore } from "@/stores/repo";
import { openCommitDiff, showGraph, useCenterView } from "@/stores/workspace";
import { CommitComments } from "@/features/forge/CommitComments";

function Person({ label, sig }: { label: string; sig: Signature }) {
  const src = useAvatar({ kind: "email", email: sig.email });
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="w-20 shrink-0 text-fg-subtle">{label}</span>
      <Avatar name={sig.name} src={src} size={28} />
      <span className="min-w-0 flex-1">
        <span className="truncate">{sig.name}</span>{" "}
        {/* Long noreply addresses wrap instead of running past the panel edge. */}
        <span className="break-all text-fg-muted">&lt;{sig.email}&gt;</span>
        <div className="text-xs text-fg-subtle">{absoluteDate(sig.time)}</div>
      </span>
    </div>
  );
}

export function CommitDetailsPanel({ repoId }: { repoId: string }) {
  const { supportsFileHistory } = usePlatform();
  const oid = useRepoStore((s) => selectedOidOf(s.selection[repoId]));
  const select = useRepoStore((s) => s.selectCommit);
  const details = useCommitDetails(repoId, oid);
  const view = useCenterView(repoId);
  const filePath = view.kind === "commitDiff" && view.oid === oid ? view.path : null;

  return (
    <aside
      id="commit-details"
      tabIndex={-1}
      aria-label="Commit details"
      className="flex h-full flex-col bg-surface outline-none"
    >
      {!oid && <p className="p-4 text-sm text-fg-muted">Select a commit to see its details.</p>}
      {oid && details.isError && <p className="p-4 text-sm text-danger">{details.error.message}</p>}
      {oid && details.isPending && !details.isError && (
        <p className="p-4 text-sm text-fg-muted">Loading…</p>
      )}
      {oid && details.data && (
        <>
          <div className="flex max-h-[55%] shrink-0 flex-col gap-2 overflow-auto border-b border-border p-3">
            <div className="flex items-start gap-2">
              <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug">
                {details.data.summary}
              </h2>
              <AiSummaryButton repoId={repoId} target={{ kind: "commit", oid }} />
            </div>
            {details.data.body && (
              <pre className="whitespace-pre-wrap font-sans text-sm text-fg-muted">
                {details.data.body}
              </pre>
            )}
            {details.data.refs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {details.data.refs.map((r) => (
                  <RefBadge key={r.fullName} label={r} />
                ))}
              </div>
            )}
            <Person label="Author" sig={details.data.author} />
            <Person label="Committer" sig={details.data.committer} />
            <div className="flex gap-2 text-sm">
              <span className="w-20 shrink-0 text-fg-subtle">Commit</span>
              <span className="font-mono text-xs">{details.data.oid}</span>
            </div>
            {details.data.parents.length > 0 && (
              <div className="flex gap-2 text-sm">
                <span className="w-20 shrink-0 text-fg-subtle">Parents</span>
                <span className="flex flex-wrap gap-2">
                  {details.data.parents.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        select(repoId, p);
                        showGraph(repoId);
                      }}
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      {p.slice(0, 7)}
                    </button>
                  ))}
                </span>
              </div>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <h3 className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {details.data.files.length} changed files
            </h3>
            <ul aria-label="Changed files" className="min-h-0 flex-1 overflow-auto">
              {details.data.files.map((f) => (
                <li key={f.path} className="group relative">
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        aria-pressed={f.path === filePath}
                        onClick={() => openCommitDiff(repoId, oid, f.path)}
                        className={cn(
                          "flex h-6 w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-hover",
                          f.path === filePath && "bg-accent-muted",
                        )}
                      >
                        <span className="w-4 shrink-0 font-mono text-xs text-fg-subtle">
                          {f.status.charAt(0).toUpperCase()}
                        </span>
                        <span className="truncate font-mono text-xs">{f.path}</span>
                        {!f.binary && (
                          <span className="ml-auto shrink-0 font-mono text-xs group-focus-within:mr-14 group-hover:mr-14">
                            <span className="text-success">+{f.additions}</span>{" "}
                            <span className="text-danger">-{f.deletions}</span>
                          </span>
                        )}
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        icon={<ScrollText />}
                        onSelect={() => openBlame(repoId, f.path, oid)}
                      >
                        Blame
                      </ContextMenuItem>
                      {supportsFileHistory && (
                        <ContextMenuItem
                          icon={<FileClock />}
                          onSelect={() => openFileHistory(repoId, f.path)}
                        >
                          File history
                        </ContextMenuItem>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                  <span className="absolute right-1 top-0.5 hidden gap-0.5 group-focus-within:flex group-hover:flex">
                    <Tooltip content="Blame">
                      <IconButton
                        size="xs"
                        aria-label={`Blame ${f.path}`}
                        onClick={() => openBlame(repoId, f.path, oid)}
                      >
                        <ScrollText />
                      </IconButton>
                    </Tooltip>
                    {supportsFileHistory && (
                      <Tooltip content="File history">
                        <IconButton
                          size="xs"
                          aria-label={`File history of ${f.path}`}
                          onClick={() => openFileHistory(repoId, f.path)}
                        >
                          <FileClock />
                        </IconButton>
                      </Tooltip>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <CommitComments repoId={repoId} oid={oid} />
        </>
      )}
    </aside>
  );
}
