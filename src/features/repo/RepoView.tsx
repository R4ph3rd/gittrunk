import { Group, Panel, Separator } from "react-resizable-panels";
import { BottomPanel } from "@/app/shell/BottomPanel";
import { CenterArea } from "@/app/shell/CenterArea";
import { RightPanel } from "@/app/shell/RightPanel";
import { usePlatform } from "@/app/platform";
import { OperationsHost } from "@/features/operations/OperationsHost";
import { OperationBanner } from "@/features/operations/sequencer/OperationBanner";
import { RemoteToolbar } from "@/features/remotes/RemoteToolbar";
import { StashDialog } from "@/features/stash/StashDialog";
import { useRepoEvents } from "@/ipc/queries";
import { useLayoutStore } from "@/stores/layout";
import { useRepoStore } from "@/stores/repo";
import { RefsSidebar } from "./RefsSidebar";

const vHandle =
  "w-px bg-border transition-colors hover:bg-accent data-[separator=active]:bg-accent";
const hHandle =
  "h-px bg-border transition-colors hover:bg-accent data-[separator=active]:bg-accent";

/** Sidebar | center (graph, diffs, issues; terminal below) | right panel for one repository. */
export function RepoView({ repoId }: { repoId: string }) {
  useRepoEvents(repoId);
  const { supportsTerminal } = usePlatform();
  const sidebar = useLayoutStore((s) => s.sidebar);
  const bottom = useLayoutStore((s) => s.bottom) && supportsTerminal;
  const right = useLayoutStore((s) => s.right);
  const path = useRepoStore((s) => s.repos.find((r) => r.id === repoId)?.path ?? "");

  return (
    <>
      <OperationBanner repoId={repoId} />
      <div className="shrink-0 bg-toolbar">
        <RemoteToolbar repoId={repoId} />
      </div>
      <Group orientation="horizontal" className="min-h-0 flex-1">
        {sidebar && (
          <>
            <Panel id="sidebar" defaultSize="18%" minSize="12%" maxSize="35%">
              <RefsSidebar repoId={repoId} />
            </Panel>
            <Separator id="sidebar-handle" className={vHandle} />
          </>
        )}
        <Panel id="center" defaultSize="52%" minSize="30%">
          <Group orientation="vertical" className="h-full">
            <Panel id="center-main" minSize="25%">
              <CenterArea repoId={repoId} />
            </Panel>
            {bottom && (
              <>
                <Separator id="bottom-handle" className={hHandle} />
                <Panel id="bottom" defaultSize="30%" minSize="15%">
                  <BottomPanel repoId={repoId} cwd={path} />
                </Panel>
              </>
            )}
          </Group>
        </Panel>
        {right && (
          <>
            <Separator id="right-handle" className={vHandle} />
            <Panel id="right" defaultSize="30%" minSize="18%">
              <RightPanel repoId={repoId} />
            </Panel>
          </>
        )}
      </Group>
      <StashDialog repoId={repoId} />
      <OperationsHost repoId={repoId} />
    </>
  );
}
