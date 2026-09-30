import { CopyPlus, FolderOpen, X } from "lucide-react";
import { usePlatform } from "@/app/platform";
import {
  IconButton,
  ListRow,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/design/components";
import { RecentRepoRows } from "@/features/repo/RecentRepos";
import { truncateMiddle } from "@/features/repo/recentPaths";
import { useCloseRepo, useOpenRepo } from "@/features/repo/useOpenRepo";
import { useRecentRepos } from "@/ipc/queries";
import { useRemotesUi } from "@/stores/remotes";
import { useRepoStore } from "@/stores/repo";

/** Bottom sheet with the open repositories (radio list), open/clone actions and recents. */
export function RepoSwitcherSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repos = useRepoStore((s) => s.repos);
  const activeId = useRepoStore((s) => s.activeId);
  const setActive = useRepoStore((s) => s.setActive);
  const setCloneOpen = useRemotesUi((s) => s.setCloneOpen);
  const { canPickFolder } = usePlatform();
  const { openPath, pickAndOpen } = useOpenRepo();
  const closeRepo = useCloseRepo();
  const recent = useRecentRepos();
  const openPaths = new Set(repos.map((r) => r.path));
  const others = (recent.data ?? []).filter((r) => !openPaths.has(r.path));

  const done = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Repositories</SheetTitle>
          <SheetDescription className="sr-only">
            Switch between open repositories, open or clone another one.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-2 pb-3">
          {repos.length > 0 ? (
            <div role="radiogroup" aria-label="Open repositories" className="flex flex-col">
              {repos.map((r) => (
                <div key={r.id} className="flex items-center">
                  <ListRow
                    role="radio"
                    aria-checked={r.id === activeId}
                    className="min-w-0 flex-1"
                    title={r.name}
                    subtitle={<span className="font-mono text-xs">{truncateMiddle(r.path)}</span>}
                    selected={r.id === activeId}
                    onClick={() => {
                      setActive(r.id);
                      done();
                    }}
                  />
                  <IconButton aria-label={`Close ${r.name}`} onClick={() => void closeRepo(r.id)}>
                    <X />
                  </IconButton>
                </div>
              ))}
            </div>
          ) : null}
          {canPickFolder ? (
            <ListRow
              title="Open folder"
              leading={<FolderOpen className="size-4" />}
              onClick={() => {
                done();
                void pickAndOpen();
              }}
            />
          ) : null}
          <ListRow
            title="Clone repository"
            leading={<CopyPlus className="size-4" />}
            onClick={() => {
              done();
              setCloneOpen(true);
            }}
          />
          {others.length > 0 ? (
            <section aria-label="Recent" className="flex flex-col">
              <h3 className="px-3 pt-2 text-xs uppercase tracking-wide text-fg-subtle">Recent</h3>
              <RecentRepoRows
                repos={others}
                onOpen={(p) => {
                  done();
                  void openPath(p);
                }}
              />
            </section>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
