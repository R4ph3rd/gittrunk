import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { isIpcError } from "@/ipc/client";
import { useAddCommitComment, useCommitComments } from "@/ipc/queries";
import { useForgeGate } from "./gate";
import { CommentComposer, CommentThread, ForgeError, Muted } from "./parts";

/** Collapsible comments of a commit. Renders nothing unless the repo has a supported forge. */
export function CommitComments({ repoId, oid }: { repoId: string; oid: string }) {
  const gate = useForgeGate(repoId);
  const ready = gate.state === "ready";
  const query = useCommitComments(repoId, oid, ready);
  const add = useAddCommitComment(repoId, oid);
  const [open, setOpen] = useState(true);
  if (gate.state !== "ready") return null;

  const notOnGithub = isIpcError(query.error) && query.error.kind === "invalidInput";
  const Chevron = open ? ChevronDown : ChevronRight;
  const count = query.data?.length ?? 0;

  return (
    <section aria-label="Commit comments" className="border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1 px-3 text-xs font-medium uppercase tracking-wide text-fg-subtle hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
      >
        <Chevron className="size-3" aria-hidden />
        Comments ({count})
      </button>
      {open ? (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {query.isError ? (
            notOnGithub ? (
              <Muted>This commit is not on GitHub</Muted>
            ) : (
              <ForgeError error={query.error} onRetry={() => void query.refetch()} />
            )
          ) : (
            <>
              <CommentThread comments={query.data ?? []} />
              <CommentComposer
                label="Comment on this commit"
                canWrite={gate.canWrite}
                onSubmit={(body) => add.mutateAsync(body)}
              />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
