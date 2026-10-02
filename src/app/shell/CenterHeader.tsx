import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { IconButton, Tooltip } from "@/design/components";
import { useWorkspaceStore, type CenterView } from "@/stores/workspace";

function PathLabel({ path }: { path: string }) {
  const i = path.lastIndexOf("/");
  return (
    <span className="min-w-0 truncate font-mono text-xs">
      <span className="text-fg-subtle">{i < 0 ? "" : path.slice(0, i + 1)}</span>
      <span className="text-fg">{i < 0 ? path : path.slice(i + 1)}</span>
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-sm bg-surface-hover px-1.5 font-mono text-xs text-fg-muted">
      {children}
    </span>
  );
}

/** 36px bar above a center view other than the graph: back button and what is shown. */
export function CenterHeader({ repoId, view }: { repoId: string; view: CenterView }) {
  const depth = useWorkspaceStore((s) => s.stacks[repoId]?.length ?? 0);
  const back = useWorkspaceStore((s) => s.back);
  const label = depth > 1 ? "Back" : "Back to graph";

  let content: ReactNode = null;
  switch (view.kind) {
    case "commitDiff":
      content = (
        <>
          <PathLabel path={view.path} />
          <Chip>{view.oid.slice(0, 7)}</Chip>
        </>
      );
      break;
    case "worktreeDiff":
      content = (
        <>
          <PathLabel path={view.path} />
          <Chip>{view.staged ? "Staged" : "Unstaged"}</Chip>
        </>
      );
      break;
    case "issues":
      content = <span className="text-sm font-medium">Issues</span>;
      break;
    case "issue":
      content = <span className="text-sm font-medium">{`Issue #${view.number}`}</span>;
      break;
    case "pulls":
      content = <span className="text-sm font-medium">Pull requests</span>;
      break;
    case "pull":
      content = <span className="text-sm font-medium">{`Pull request #${view.number}`}</span>;
      break;
    case "newIssue":
      content = <span className="text-sm font-medium">New issue</span>;
      break;
    default:
      break;
  }

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-panel-header px-2">
      <Tooltip content={label} shortcut="Esc">
        <IconButton size="sm" aria-label={label} onClick={() => back(repoId)}>
          <ArrowLeft />
        </IconButton>
      </Tooltip>
      {content}
    </div>
  );
}
