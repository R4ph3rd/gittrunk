import { Group, Panel, Separator } from "react-resizable-panels";
import { GraphView } from "@/features/graph/GraphView";
import { useRepoEvents } from "@/ipc/queries";
import { CommitDetailsPanel } from "./CommitDetailsPanel";
import { RefsSidebar } from "./RefsSidebar";

const handle = "w-px bg-border transition-colors hover:bg-accent data-[separator=active]:bg-accent";

/** Sidebar | graph | details for one open repository. */
export function RepoView({ repoId }: { repoId: string }) {
  useRepoEvents(repoId);
  return (
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
        <CommitDetailsPanel repoId={repoId} />
      </Panel>
    </Group>
  );
}
