import { Plus } from "lucide-react";
import { IconButton, Tooltip } from "@/design/components";
import { Item, Section } from "@/features/repo/SidebarParts";
import { useIssues } from "@/ipc/queries";
import { openIssue, openIssues, openNewIssue } from "@/stores/workspace";
import { NO_REMOTE_TEXT, UNSUPPORTED_TEXT, useForgeGate } from "./gate";
import { ForgeError, StateDot } from "./parts";

const SIDEBAR_LIMIT = 10;

function Line({ children }: { children: React.ReactNode }) {
  return <li className="px-6 py-1 text-xs text-fg-muted">{children}</li>;
}

/** Sidebar section listing the first open issues of the GitHub origin. Never polls. */
export function IssuesSection({ repoId }: { repoId: string }) {
  const gate = useForgeGate(repoId);
  const ready = gate.state === "ready";
  // Fetches once per stale period, also while the section is collapsed (the query lives here).
  const issues = useIssues(repoId, "open", { enabled: ready });
  const items = (issues.data?.pages[0]?.items ?? []).slice(0, SIDEBAR_LIMIT);
  const count = issues.data?.pages.flatMap((p) => p.items).length ?? 0;

  const actions =
    ready && gate.canWrite ? (
      <Tooltip content="New issue">
        <IconButton size="xs" aria-label="New issue" onClick={() => openNewIssue(repoId)}>
          <Plus />
        </IconButton>
      </Tooltip>
    ) : undefined;

  let body: React.ReactNode;
  if (gate.state === "loading") body = <Line>Loading issues…</Line>;
  else if (gate.state === "noRemote") body = <Line>{NO_REMOTE_TEXT}</Line>;
  else if (gate.state === "unsupported") body = <Line>{UNSUPPORTED_TEXT}</Line>;
  else if (gate.state === "error")
    body = (
      <li className="px-6 py-1">
        <ForgeError error={gate.error} onRetry={gate.retry} />
      </li>
    );
  else if (issues.isPending) body = <Line>Loading issues…</Line>;
  else if (issues.isError)
    body = (
      <li className="px-6 py-1">
        <ForgeError error={issues.error} onRetry={() => void issues.refetch()} />
      </li>
    );
  else
    body = (
      <>
        {items.length === 0 ? <Line>No open issues</Line> : null}
        {items.map((issue) => (
          <Item
            key={issue.number}
            label={`#${issue.number} ${issue.title}`}
            leading={<StateDot state={issue.state} />}
            onClick={() => openIssue(repoId, issue.number)}
          />
        ))}
        <Item label="Show all issues" onClick={() => openIssues(repoId)} />
      </>
    );

  return (
    <Section title="Issues" count={count} actions={actions}>
      {body}
    </Section>
  );
}
