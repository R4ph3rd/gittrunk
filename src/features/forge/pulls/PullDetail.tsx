import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { Button, Spinner } from "@/design/components";
import type { ForgePull } from "@/ipc/bindings";
import { absoluteDate, relativeDate } from "@/features/graph/format";
import { useAddPullComment, useForgeStatus, usePull, useRefs } from "@/ipc/queries";
import { cn } from "@/lib/cn";
import {
  CommentComposer,
  CommentItem,
  CommentThread,
  CopyLinkButton,
  ForgeError,
  OpenInBrowserButton,
} from "../parts";
import { checkoutPull, isCheckedOut } from "./checkout";
import { BranchChip, PullStateBadge } from "./parts";

const VERB = { open: "wants to merge", merged: "merged", closed: "closed" } as const;

function CheckoutButton({
  repoId,
  pull,
  remote,
}: {
  repoId: string;
  pull: ForgePull;
  remote: string;
}) {
  const client = useQueryClient();
  const refs = useRefs(repoId).data;
  const [busy, setBusy] = useState(false);
  if (pull.head.isFork) {
    return <span className="text-sm text-fg-muted">From a fork: open it on GitHub to review</span>;
  }
  const done = isCheckedOut(refs, pull);
  return (
    <Button
      size="sm"
      disabled={done}
      loading={busy}
      onClick={() => {
        setBusy(true);
        void checkoutPull(client, repoId, pull, remote).finally(() => setBusy(false));
      }}
    >
      <GitBranch />
      {done ? "Checked out" : "Check out branch"}
    </Button>
  );
}

/** Pull request header, stats, actions, description and conversation. Pair with `PullComposer`. */
export function PullDetail({
  repoId,
  number,
  compact = false,
}: {
  repoId: string;
  number: number;
  /** Stack the action row (compact layouts). */
  compact?: boolean;
}) {
  const query = usePull(repoId, number);
  const remote = useForgeStatus(repoId).data?.repo?.remote ?? "origin";
  if (query.isPending) {
    return (
      <div className="p-4">
        <Spinner label="Loading pull request" />
      </div>
    );
  }
  if (query.isError) {
    return <ForgeError className="p-4" error={query.error} onRetry={() => void query.refetch()} />;
  }
  const { pull, body, comments, commits, additions, deletions, changedFiles } = query.data;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-col gap-2">
        <h2 className="break-words text-xl font-semibold text-fg">
          {pull.title} <span className="font-mono text-fg-muted">#{pull.number}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          <PullStateBadge pull={pull} />
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            <span>
              {pull.author.login} {VERB[pull.state]} {commits}{" "}
              {commits === 1 ? "commit" : "commits"} into
            </span>
            <BranchChip repoId={repoId} branch={pull.base} remote={remote} />
            <span>from</span>
            <BranchChip repoId={repoId} branch={pull.head} remote={remote} />
          </span>
          <span title={absoluteDate(pull.createdAt)}>opened {relativeDate(pull.createdAt)}</span>
          {pull.updatedAt !== pull.createdAt ? (
            <span title={absoluteDate(pull.updatedAt)}>updated {relativeDate(pull.updatedAt)}</span>
          ) : null}
        </div>
        <p className="text-sm text-fg-muted">
          <span className="font-mono text-success">+{additions}</span>{" "}
          <span className="font-mono text-danger">−{deletions}</span> · {changedFiles}{" "}
          {changedFiles === 1 ? "file" : "files"}
        </p>
        <div
          className={cn(
            "flex gap-2",
            compact ? "flex-col items-stretch" : "flex-wrap items-center",
          )}
        >
          <CheckoutButton repoId={repoId} pull={pull} remote={remote} />
          <OpenInBrowserButton url={pull.url} />
          <CopyLinkButton url={pull.url} />
        </div>
      </div>
      <div className="border-y border-border">
        <CommentItem
          author={pull.author.login}
          createdAt={pull.createdAt}
          body={body}
          emptyText="No description provided."
        />
      </div>
      <CommentThread comments={comments} />
    </div>
  );
}

export function PullComposer({
  repoId,
  number,
  canWrite,
  className,
}: {
  repoId: string;
  number: number;
  canWrite: boolean;
  className?: string;
}) {
  const add = useAddPullComment(repoId, number);
  return (
    <CommentComposer
      label="Add a comment"
      canWrite={canWrite}
      onSubmit={(body) => add.mutateAsync(body)}
      className={className ?? ""}
    />
  );
}
