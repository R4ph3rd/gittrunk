import { useState, type ReactNode } from "react";
import { GitPullRequest } from "lucide-react";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import type { RouteScreenProps } from "@/app/layout/registry";
import {
  Badge,
  Button,
  EmptyState,
  ListRow,
  PullToRefresh,
  SegmentedControl,
  Spinner,
} from "@/design/components";
import { relativeDate } from "@/features/graph/format";
import { usePulls } from "@/ipc/queries";
import { useNav } from "@/stores/nav";
import { useForgeGate } from "../gate";
import { ForgeError } from "../parts";
import { PullComposer, PullDetail } from "../pulls/PullDetail";
import { NO_REMOTE, PullStateIcon, UNSUPPORTED } from "../pulls/parts";

type Filter = "open" | "closed";

function GateMessage({ state }: { state: "noRemote" | "unsupported" }) {
  return (
    <EmptyState
      className="m-4"
      icon={<GitPullRequest />}
      title={state === "noRemote" ? NO_REMOTE : UNSUPPORTED}
    />
  );
}

/** Pull request list of the Issues tab: open / closed switch, pull to refresh, tap to open. */
export function PullsList({ repoId }: { repoId: string }) {
  const nav = useNav();
  const gate = useForgeGate(repoId);
  const ready = gate.state === "ready";
  const [filter, setFilter] = useState<Filter>("open");
  const query = usePulls(repoId, filter, { enabled: ready });
  const pulls = query.data?.pages.flatMap((p) => p.items) ?? [];

  let body: ReactNode;
  if (gate.state === "loading" || (ready && query.isPending)) {
    body = (
      <div className="flex justify-center p-6">
        <Spinner label="Loading pull requests" />
      </div>
    );
  } else if (gate.state === "error") {
    body = <ForgeError className="p-4" error={gate.error} onRetry={gate.retry} />;
  } else if (gate.state === "noRemote" || gate.state === "unsupported") {
    body = <GateMessage state={gate.state} />;
  } else if (query.isError) {
    body = <ForgeError className="p-4" error={query.error} onRetry={() => void query.refetch()} />;
  } else if (pulls.length === 0) {
    body = (
      <EmptyState className="m-4" icon={<GitPullRequest />} title={`No ${filter} pull requests`} />
    );
  } else {
    body = (
      <ul aria-label="Pull requests" className="divide-y divide-border">
        {pulls.map((pull) => (
          <li key={pull.number}>
            <ListRow
              className="min-h-[52px]"
              leading={<PullStateIcon pull={pull} />}
              title={`#${pull.number} ${pull.title}`}
              subtitle={`${pull.author.login} · ${pull.head.isFork ? pull.head.label : pull.head.name} → ${pull.base.name} · updated ${relativeDate(pull.updatedAt)}`}
              trailing={pull.draft ? <Badge>Draft</Badge> : null}
              chevron
              onClick={() => nav.push({ name: "pull", number: pull.number })}
            />
          </li>
        ))}
        {query.hasNextPage ? (
          <li className="p-3">
            <Button
              className="w-full"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Load more
            </Button>
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <>
      {ready ? (
        <div className="px-3 pb-2">
          <SegmentedControl<Filter>
            aria-label="Pull request state"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
            ]}
          />
        </div>
      ) : null}
      <PullToRefresh
        className="flex-1"
        disabled={!ready}
        onRefresh={() => query.refetch()}
        label="Refreshing pull requests"
      >
        {body}
      </PullToRefresh>
    </>
  );
}

/** A pull request with its conversation; the composer stays pinned above the keyboard. */
export function PullScreen({ repoId, route }: RouteScreenProps<"pull">) {
  const gate = useForgeGate(repoId);
  let content: ReactNode;
  if (gate.state === "loading") {
    content = (
      <div className="flex justify-center p-6">
        <Spinner label="Loading" />
      </div>
    );
  } else if (gate.state === "error") {
    content = <ForgeError className="p-4" error={gate.error} onRetry={gate.retry} />;
  } else if (gate.state !== "ready") {
    content = <GateMessage state={gate.state} />;
  } else {
    content = <PullDetail repoId={repoId} number={route.number} compact />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <ShellAppBar repoId={repoId} back title={`#${route.number}`} subtitle="Pull request" />
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      {gate.state === "ready" ? (
        <div
          className="shrink-0 border-t border-border bg-surface px-3 pt-2 pb-[max(0.5rem,var(--kb-inset))]"
          data-testid="pull-composer-dock"
        >
          <PullComposer repoId={repoId} number={route.number} canWrite={gate.canWrite} />
        </div>
      ) : null}
    </div>
  );
}
