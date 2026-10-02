import { GitPullRequest } from "lucide-react";
import { EmptyState, Spinner } from "@/design/components";
import type { PullCenterView } from "@/stores/workspace";
import { useForgeGate } from "../gate";
import { ForgeError } from "../parts";
import { PullComposer, PullDetail } from "./PullDetail";
import { PullList } from "./PullList";
import { NO_REMOTE, UNSUPPORTED } from "./parts";

/** Pull request list and detail for the center. Content only: the shell owns the header. */
export function PullMainView({ repoId, view }: { repoId: string; view: PullCenterView }) {
  const gate = useForgeGate(repoId);

  if (gate.state === "loading") {
    return (
      <div className="p-4" data-testid="pull-main-view">
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
        icon={<GitPullRequest />}
        title={gate.state === "noRemote" ? NO_REMOTE : UNSUPPORTED}
      />
    );
  }

  return (
    <div
      data-testid="pull-main-view"
      data-view={view.kind}
      className="flex min-h-0 flex-1 flex-col"
    >
      {view.kind === "pulls" ? <PullList repoId={repoId} /> : null}
      {view.kind === "pull" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PullDetail repoId={repoId} number={view.number} />
          <PullComposer
            repoId={repoId}
            number={view.number}
            canWrite={gate.canWrite}
            className="px-4 pb-4"
          />
        </div>
      ) : null}
    </div>
  );
}
