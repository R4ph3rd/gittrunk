import { useState } from "react";
import { CircleDot, Plus } from "lucide-react";
import { Button, EmptyState, SegmentedControl, Spinner } from "@/design/components";
import type { IssueStateFilter } from "@/ipc/bindings";
import { useIssues } from "@/ipc/queries";
import {
  openIssue,
  useWorkspaceStore,
  openNewIssue,
  type ForgeCenterView,
} from "@/stores/workspace";
import { NO_REMOTE_TEXT, UNSUPPORTED_TEXT, useForgeGate } from "./gate";
import { IssueBody, IssueComposer, NewIssueForm } from "./IssueViews";
import { ForgeError, IssueRow } from "./parts";

function IssueList({ repoId, canWrite }: { repoId: string; canWrite: boolean }) {
  const [filter, setFilter] = useState<IssueStateFilter>("open");
  const query = useIssues(repoId, filter);
  const issues = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <SegmentedControl<IssueStateFilter>
          aria-label="Issue state"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "open", label: "Open" },
            { value: "closed", label: "Closed" },
            { value: "all", label: "All" },
          ]}
        />
        {canWrite ? (
          <Button variant="primary" size="sm" onClick={() => openNewIssue(repoId)}>
            <Plus />
            New issue
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <div className="p-4">
            <Spinner label="Loading issues" />
          </div>
        ) : query.isError ? (
          <ForgeError className="p-4" error={query.error} onRetry={() => void query.refetch()} />
        ) : issues.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={<CircleDot />}
            title={filter === "all" ? "No issues" : `No ${filter} issues`}
          />
        ) : (
          <ul aria-label="Issues">
            {issues.map((issue) => (
              <IssueRow
                key={issue.number}
                issue={issue}
                onOpen={() => openIssue(repoId, issue.number)}
              />
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

/** Issue list, issue and new-issue views for the center. Content only: the shell owns the header. */
export function ForgeMainView({ repoId, view }: { repoId: string; view: ForgeCenterView }) {
  const gate = useForgeGate(repoId);

  if (gate.state === "loading") {
    return (
      <div className="p-4" data-testid="forge-main-view">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (gate.state === "error") {
    return <ForgeError className="p-4" error={gate.error} onRetry={gate.retry} />;
  }
  if (gate.state !== "ready") {
    return (
      <EmptyState
        className="m-4"
        icon={<CircleDot />}
        title={gate.state === "noRemote" ? NO_REMOTE_TEXT : UNSUPPORTED_TEXT}
      />
    );
  }

  return (
    <div
      data-testid="forge-main-view"
      data-view={view.kind}
      className="flex min-h-0 flex-1 flex-col"
    >
      {view.kind === "issues" ? <IssueList repoId={repoId} canWrite={gate.canWrite} /> : null}
      {view.kind === "issue" ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <IssueBody repoId={repoId} number={view.number} />
            <IssueComposer
              repoId={repoId}
              number={view.number}
              canWrite={gate.canWrite}
              className="px-4 pb-4"
            />
          </div>
        </>
      ) : null}
      {view.kind === "newIssue" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NewIssueForm
            repoId={repoId}
            canWrite={gate.canWrite}
            onCancel={() => useWorkspaceStore.getState().back(repoId)}
            onCreated={(created) => {
              // Replace the form with the new issue in the back stack.
              useWorkspaceStore.getState().back(repoId);
              openIssue(repoId, created.number);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
