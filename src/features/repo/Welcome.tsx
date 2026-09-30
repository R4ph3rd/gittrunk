import { CopyPlus, FolderOpen, GitBranch } from "lucide-react";
import { useRecentRepos } from "@/ipc/queries";
import { useRemotesUi } from "@/stores/remotes";
import { useRepoStore } from "@/stores/repo";
import { useOpenRepo } from "./useOpenRepo";

export function Welcome() {
  const { openPath, pickAndOpen } = useOpenRepo();
  const recent = useRecentRepos();
  const error = useRepoStore((s) => s.openError);
  const setCloneOpen = useRemotesUi((s) => s.setCloneOpen);

  return (
    <div className="flex flex-1 items-center justify-center bg-chrome p-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <GitBranch className="size-8 text-accent" aria-hidden />
          <h1 className="text-xl font-semibold tracking-tight">Open a repository</h1>
          <p className="text-sm text-fg-muted">Choose a folder that contains a git repository.</p>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void pickAndOpen()}
              className="flex h-8 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
            >
              <FolderOpen className="size-4" aria-hidden />
              Open
            </button>
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
        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
        {recent.data && recent.data.length > 0 && (
          <section aria-label="Recent repositories" className="flex flex-col gap-1">
            <h2 className="text-xs uppercase tracking-wide text-fg-subtle">Recent</h2>
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
          </section>
        )}
      </div>
    </div>
  );
}
