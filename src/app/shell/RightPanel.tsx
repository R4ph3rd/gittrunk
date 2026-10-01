import { useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/design/components";
import { CommitDetailsPanel } from "@/features/repo/CommitDetailsPanel";
import { StagingPanel } from "@/features/staging/StagingPanel";
import { useStatus } from "@/ipc/queries";
import { usePlatform } from "@/app/platform";
import { useRepoStore } from "@/stores/repo";
import { useRightTab, useWorkspaceStore, type RightTab } from "@/stores/workspace";

/** Right panel: a Commit tab (details of the selected commit) and a Changes tab (working copy). */
export function RightPanel({ repoId }: { repoId: string }) {
  const { readOnly } = usePlatform();
  const stored = useRightTab(repoId);
  const setRightTab = useWorkspaceStore((s) => s.setRightTab);
  const selectionKind = useRepoStore((s) => s.selection[repoId]?.kind);
  const status = useStatus(repoId).data;
  const count = status
    ? status.staged.length + status.unstaged.length + status.conflicted.length
    : 0;
  const tab: RightTab = readOnly ? "commit" : stored;

  // The selection decides the tab; the user can still switch by hand afterwards.
  useEffect(() => {
    if (selectionKind === "commit") setRightTab(repoId, "commit");
    else if (selectionKind === "wip") setRightTab(repoId, "changes");
  }, [repoId, selectionKind, setRightTab]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {!readOnly && (
        <Tabs value={tab} onValueChange={(v) => setRightTab(repoId, v as RightTab)}>
          <TabsList className="h-9 w-full shrink-0 items-center gap-1 bg-panel-header px-2">
            <TabsTrigger value="commit">Commit</TabsTrigger>
            <TabsTrigger value="changes" className="gap-1.5">
              Changes
              {count > 0 && (
                <span
                  data-testid="changes-count"
                  className="rounded-full bg-accent-muted px-1.5 font-mono text-xs text-fg"
                >
                  {count}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <div className="min-h-0 flex-1">
        {tab === "changes" ? (
          <StagingPanel repoId={repoId} />
        ) : (
          <CommitDetailsPanel repoId={repoId} />
        )}
      </div>
    </div>
  );
}
