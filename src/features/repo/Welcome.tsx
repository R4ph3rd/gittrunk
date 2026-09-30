import { CopyPlus, FolderOpen, GitBranch } from "lucide-react";
import { useLayout } from "@/app/layout/useLayout";
import { usePlatform } from "@/app/platform";
import { Button } from "@/design/components";
import { useRecentRepos } from "@/ipc/queries";
import { useRemotesUi } from "@/stores/remotes";
import { useRepoStore } from "@/stores/repo";
import { RecentRepoRows } from "./RecentRepos";
import { useOpenRepo } from "./useOpenRepo";

export function Welcome() {
  const { openPath, pickAndOpen } = useOpenRepo();
  const recent = useRecentRepos();
  const error = useRepoStore((s) => s.openError);
  const setCloneOpen = useRemotesUi((s) => s.setCloneOpen);
  const { isCompact } = useLayout();
  const { canPickFolder, defaultReposDir } = usePlatform();

  const errorNode = error && (
    <p role="alert" className="rounded-md border border-danger/40 px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );
  const hasRecent = recent.data && recent.data.length > 0;

  if (isCompact) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-chrome pb-[var(--safe-bottom)] pl-[var(--safe-left)] pr-[var(--safe-right)] pt-[var(--safe-top)]">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <GitBranch className="size-8 text-accent" aria-hidden />
            <h1 className="text-xl font-semibold tracking-tight">Open a repository</h1>
            <p className="text-base text-fg-muted">
              {canPickFolder
                ? "Choose a folder that contains a git repository, or clone one."
                : "Clone a repository to get started."}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {canPickFolder ? (
              <Button
                variant="primary"
                className="h-[var(--touch-target-row)] w-full text-base"
                onClick={() => void pickAndOpen()}
              >
                <FolderOpen />
                Open folder
              </Button>
            ) : null}
            <Button
              variant={canPickFolder ? "secondary" : "primary"}
              className="h-[var(--touch-target-row)] w-full text-base"
              onClick={() => setCloneOpen(true)}
            >
              <CopyPlus />
              Clone repository
            </Button>
          </div>
          {errorNode}
          {hasRecent && (
            <section aria-label="Recent repositories" className="flex flex-col gap-1">
              <h2 className="text-xs uppercase tracking-wide text-fg-subtle">Recent</h2>
              <RecentRepoRows repos={recent.data} onOpen={(p) => void openPath(p)} />
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-chrome p-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <GitBranch className="size-8 text-accent" aria-hidden />
          <h1 className="text-xl font-semibold tracking-tight">Open a repository</h1>
          <p className="text-sm text-fg-muted">
            {canPickFolder
              ? "Choose a folder that contains a git repository."
              : "Clone a repository to get started."}
          </p>
          <div className="mt-1 flex items-center gap-2">
            {canPickFolder ? (
              <button
                type="button"
                onClick={() => void pickAndOpen()}
                className="flex h-8 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
              >
                <FolderOpen className="size-4" aria-hidden />
                Open
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setCloneOpen(true)}
              className="flex h-8 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-fg hover:bg-surface-hover"
            >
              <CopyPlus className="size-4" aria-hidden />
              Clone repository
            </button>
          </div>
        </div>
        {errorNode}
        {hasRecent && (
          <section aria-label="Recent repositories" className="flex flex-col gap-1">
            <h2 className="text-xs uppercase tracking-wide text-fg-subtle">Recent</h2>
            {defaultReposDir ? (
              <RecentRepoRows repos={recent.data} onOpen={(p) => void openPath(p)} />
            ) : (
              <ul className="flex flex-col">
                {recent.data.map((r) => (
                  <li key={r.path}>
                    <button
                      type="button"
                      onClick={() => void openPath(r.path)}
                      className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left hover:bg-surface-hover"
                    >
                      <span className="text-sm">{r.name}</span>
                      <span className="truncate font-mono text-xs text-fg-subtle">{r.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
