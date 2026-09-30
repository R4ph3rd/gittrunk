import { FolderOpen, GitBranch, X } from "lucide-react";
import { usePlatform } from "@/app/platform";
import { cn } from "@/lib/cn";
import { useRepoStore } from "@/stores/repo";
import { useCloseRepo, useOpenRepo } from "./useOpenRepo";

/** Top bar: brand, one tab per open repo, and the Open button. */
export function RepoTabs() {
  const repos = useRepoStore((s) => s.repos);
  const activeId = useRepoStore((s) => s.activeId);
  const setActive = useRepoStore((s) => s.setActive);
  const error = useRepoStore((s) => s.openError);
  const { pickAndOpen } = useOpenRepo();
  const close = useCloseRepo();
  const { canPickFolder } = usePlatform();

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <GitBranch className="size-4 text-accent" aria-hidden />
      <span className="mr-2 text-sm font-medium tracking-tight">gittrunk</span>
      <div
        role="tablist"
        aria-label="Open repositories"
        className="flex min-w-0 items-center gap-1"
      >
        {repos.map((r) => (
          <div
            key={r.id}
            className={cn(
              "flex h-7 items-center gap-1 rounded-sm border pl-2.5 pr-1 text-sm",
              r.id === activeId
                ? "border-border-strong bg-surface text-fg"
                : "border-transparent text-fg-muted hover:bg-surface-hover",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={r.id === activeId}
              onClick={() => setActive(r.id)}
              title={r.path}
              className="max-w-40 truncate"
            >
              {r.name}
            </button>
            <button
              type="button"
              aria-label={`Close ${r.name}`}
              onClick={() => void close(r.id)}
              className="rounded-sm p-0.5 text-fg-subtle hover:bg-surface-hover hover:text-fg"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>
      {canPickFolder ? (
        <button
          type="button"
          onClick={() => void pickAndOpen()}
          className="ml-1 flex h-7 items-center gap-1.5 rounded-sm border border-border px-2 text-sm text-fg-muted hover:bg-surface-hover"
        >
          <FolderOpen className="size-3.5" aria-hidden />
          Open
        </button>
      ) : null}
      {error && repos.length > 0 && (
        <span role="alert" className="ml-2 truncate text-sm text-danger">
          {error}
        </span>
      )}
    </header>
  );
}
