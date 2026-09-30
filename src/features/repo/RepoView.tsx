import { Group, Panel, Separator } from "react-resizable-panels";
import { GraphView } from "@/features/graph/GraphView";
import { StagingPanel } from "@/features/staging/StagingPanel";
import { StashDialog } from "@/features/stash/StashDialog";
import { useRepoEvents } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { CommitDetailsPanel } from "./CommitDetailsPanel";
import { RefsSidebar } from "./RefsSidebar";

const handle = "w-px bg-border transition-colors hover:bg-accent data-[separator=active]:bg-accent";

/** Sidebar | graph | details (or the staging view while WIP is selected) for one repository. */
export function RepoView({ repoId }: { repoId: string }) {
  useRepoEvents(repoId);
  const wip = useRepoStore((s) => s.selection[repoId]?.kind === "wip");
  return (
    <>
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize="18%" minSize="12%" maxSize="35%">
          <RefsSidebar repoId={repoId} />
        </Panel>
        <Separator className={handle} />
        <Panel defaultSize="52%" minSize="30%">
          <GraphView
            repoId={repoId}
            onOpenDetails={() => document.getElementById("commit-details")?.focus()}
          />
        </Panel>
        <Separator className={handle} />
        <Panel defaultSize="30%" minSize="18%">
          {wip ? <StagingPanel repoId={repoId} /> : <CommitDetailsPanel repoId={repoId} />}
        </Panel>
      </Group>
      <StashDialog repoId={repoId} />
    </>
  );
}
