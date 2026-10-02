import { useState, type ReactNode } from "react";
import { CircleDot, Plus } from "lucide-react";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import type { RouteScreenProps, TabScreenProps } from "@/app/layout/registry";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  ListRow,
  PullToRefresh,
  SegmentedControl,
  Spinner,
} from "@/design/components";
import { relativeDate } from "@/features/graph/format";
import type { IssueStateFilter } from "@/ipc/bindings";
import { useIssues } from "@/ipc/queries";
import { useNav } from "@/stores/nav";
import { commentsLabel } from "../helpers";
import { NO_REMOTE_TEXT, UNSUPPORTED_TEXT, useForgeGate } from "../gate";
import { IssueBody, IssueComposer, NewIssueForm } from "../IssueViews";
import { ForgeError, StateDot } from "../parts";
import { PullsList } from "./pullScreens";

function GateMessage({ state }: { state: "noRemote" | "unsupported" }) {
  return (
    <EmptyState
      className="m-4"
      icon={<CircleDot />}
      title={state === "noRemote" ? NO_REMOTE_TEXT : UNSUPPORTED_TEXT}
    />
  );
}

function Screen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col bg-surface">{children}</div>;
}

/** The Issues tab. */
export function IssuesScreen({ repoId }: TabScreenProps) {
  const nav = useNav();
  const gate = useForgeGate(repoId);
  const ready = gate.state === "ready";
  const [show, setShow] = useState<"issues" | "pulls">("issues");
  const [filter, setFilter] = useState<Exclude<IssueStateFilter, "all">>("open");
  const query = useIssues(repoId, filter, { enabled: ready && show === "issues" });
  const issues = query.data?.pages.flatMap((p) => p.items) ?? [];
  const canWrite = gate.state === "ready" && gate.canWrite;

  let body: ReactNode;
  if (gate.state === "loading" || (ready && query.isPending)) {
    body = (
      <div className="flex justify-center p-6">
        <Spinner label="Loading issues" />
      </div>
    );
  } else if (gate.state === "error") {
    body = <ForgeError className="p-4" error={gate.error} onRetry={gate.retry} />;
  } else if (gate.state === "noRemote" || gate.state === "unsupported") {
    body = <GateMessage state={gate.state} />;
  } else if (query.isError) {
    body = <ForgeError className="p-4" error={query.error} onRetry={() => void query.refetch()} />;
  } else if (issues.length === 0) {
    body = <EmptyState className="m-4" icon={<CircleDot />} title={`No ${filter} issues`} />;
  } else {
    body = (
      <ul aria-label="Issues" className="divide-y divide-border">
        {issues.map((issue) => (
          <li key={issue.number}>
            <ListRow
              className="min-h-[52px]"
              leading={<StateDot state={issue.state} />}
              title={`#${issue.number} ${issue.title}`}
              subtitle={`${issue.author.login} · ${relativeDate(issue.updatedAt)} · ${commentsLabel(issue.comments)}`}
              trailing={issue.labels.slice(0, 2).map((l) => (
                <Badge key={l}>{l}</Badge>
              ))}
              chevron
              onClick={() => nav.push({ name: "issue", number: issue.number })}
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
    <Screen>
      <ShellAppBar
        repoId={repoId}
        title="Issues"
        actions={
          canWrite && show === "issues" ? (
            <IconButton aria-label="New issue" onClick={() => nav.push({ name: "newIssue" })}>
              <Plus />
            </IconButton>
          ) : null
        }
      >
        <div className="px-3 pb-2">
          <SegmentedControl<"issues" | "pulls">
            aria-label="Show"
            value={show}
            onValueChange={setShow}
            options={[
              { value: "issues", label: "Issues" },
              { value: "pulls", label: "Pull requests" },
            ]}
          />
        </div>
        {ready && show === "issues" ? (
          <div className="px-3 pb-2">
            <SegmentedControl<"open" | "closed">
              aria-label="Issue state"
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: "open", label: "Open" },
                { value: "closed", label: "Closed" },
              ]}
            />
          </div>
        ) : null}
      </ShellAppBar>
      {show === "pulls" ? (
        <PullsList repoId={repoId} />
      ) : (
        <PullToRefresh
          className="flex-1"
          disabled={!ready}
          onRefresh={() => query.refetch()}
          label="Refreshing issues"
        >
          {body}
        </PullToRefresh>
      )}
    </Screen>
  );
}

/** An issue with its comments; the composer stays pinned above the keyboard. */
export function IssueScreen({ repoId, route }: RouteScreenProps<"issue">) {
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
    content = <IssueBody repoId={repoId} number={route.number} />;
  }
  return (
    <Screen>
      <ShellAppBar repoId={repoId} back title={`Issue #${route.number}`} />
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      {gate.state === "ready" ? (
        <div
          className="shrink-0 border-t border-border bg-surface px-3 pt-2 pb-[max(0.5rem,var(--kb-inset))]"
          data-testid="issue-composer-dock"
        >
          <IssueComposer repoId={repoId} number={route.number} canWrite={gate.canWrite} />
        </div>
      ) : null}
    </Screen>
  );
}

export function NewIssueScreen({ repoId }: RouteScreenProps<"newIssue">) {
  const nav = useNav();
  const gate = useForgeGate(repoId);
  return (
    <Screen>
      <ShellAppBar repoId={repoId} back title="New issue" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {gate.state === "ready" ? (
          <NewIssueForm
            repoId={repoId}
            canWrite={gate.canWrite}
            onCancel={() => void nav.pop()}
            onCreated={(created) => nav.replace({ name: "issue", number: created.number })}
          />
        ) : gate.state === "error" ? (
          <ForgeError className="p-4" error={gate.error} onRetry={gate.retry} />
        ) : gate.state === "loading" ? (
          <div className="flex justify-center p-6">
            <Spinner label="Loading" />
          </div>
        ) : (
          <GateMessage state={gate.state} />
        )}
      </div>
    </Screen>
  );
}
