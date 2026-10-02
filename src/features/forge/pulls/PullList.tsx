import { useState } from "react";
import { ArrowRight, GitPullRequest } from "lucide-react";
import { Badge, Button, EmptyState, SegmentedControl, Spinner } from "@/design/components";
import { absoluteDate, relativeDate } from "@/features/graph/format";
import type { ForgePull, PullStateFilter } from "@/ipc/bindings";
import { useForgeStatus, usePulls } from "@/ipc/queries";
import { openPull } from "@/stores/workspace";
import { ForgeError } from "../parts";
import { AuthorAvatar, BranchChip, PullStateIcon } from "./parts";

function PullRow({ repoId, pull, remote }: { repoId: string; pull: ForgePull; remote: string }) {
  return (
    <li className="relative border-b border-border px-4 py-2 hover:bg-surface-hover">
      <span className="flex items-center gap-2 text-base text-fg">
        <PullStateIcon pull={pull} />
        <span className="font-mono text-fg-muted">#{pull.number}</span>
        <button
          type="button"
          onClick={() => openPull(repoId, pull.number)}
          className="min-w-0 flex-1 truncate text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[color:var(--focus-ring)]"
        >
          {pull.title}
        </button>
        {pull.draft ? <Badge>Draft</Badge> : null}
        {pull.labels.map((l) => (
          <Badge key={l}>{l}</Badge>
        ))}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-sm text-fg-muted">
        <BranchChip repoId={repoId} branch={pull.head} remote={remote} />
        <ArrowRight className="size-3 shrink-0" aria-hidden />
        <BranchChip repoId={repoId} branch={pull.base} remote={remote} />
        <span className="inline-flex items-center gap-1">
          <AuthorAvatar login={pull.author.login} size={16} />
          {pull.author.login}
        </span>
        <span title={absoluteDate(pull.updatedAt)}>updated {relativeDate(pull.updatedAt)}</span>
      </span>
    </li>
  );
}

/** Open / closed / all pull requests of the repository. */
export function PullList({ repoId }: { repoId: string }) {
  const [filter, setFilter] = useState<PullStateFilter>("open");
  const query = usePulls(repoId, filter);
  const remote = useForgeStatus(repoId).data?.repo?.remote ?? "origin";
  const pulls = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <SegmentedControl<PullStateFilter>
          aria-label="Pull request state"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "open", label: "Open" },
            { value: "closed", label: "Closed" },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <div className="p-4">
            <Spinner label="Loading pull requests" />
          </div>
        ) : query.isError ? (
          <ForgeError className="p-4" error={query.error} onRetry={() => void query.refetch()} />
        ) : pulls.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={<GitPullRequest />}
            title={filter === "all" ? "No pull requests" : `No ${filter} pull requests`}
          />
        ) : (
          <ul aria-label="Pull requests">
            {pulls.map((pull) => (
              <PullRow key={pull.number} repoId={repoId} pull={pull} remote={remote} />
            ))}
          </ul>
        )}
        {query.hasNextPage ? (
          <div className="p-3">
            <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
