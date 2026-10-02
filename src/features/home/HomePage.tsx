import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CopyPlus, FolderOpen, FolderPlus, LayoutGrid, MoreVertical, Plug } from "lucide-react";
import { usePlatform } from "@/app/platform";
import {
  AlertDialog,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  MeshBackdrop,
  toast,
} from "@/design/components";
import { commands, type KnownRepo, type Workspace } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateRepoLists, useKnownRepos, useRecentRepos } from "@/ipc/queries";
import { useOpenRepo } from "@/features/repo/useOpenRepo";
import { useRemotesUi } from "@/stores/remotes";
import { useRepoStore } from "@/stores/repo";
import { openSettings, updateSettings, useSettings } from "@/stores/settings";
import { KnownList, RecentList, RepoCard } from "./RepoLists";
import { useHomeDialogs } from "./store";

/** Home: actions, workspaces, recent and known repositories over the page gradient. */
export function HomePage() {
  const { canPickFolder, readOnly } = usePlatform();
  const settings = useSettings();
  const { openPath, pickAndOpen } = useOpenRepo();
  const known = useKnownRepos();
  const recent = useRecentRepos();
  const error = useRepoStore((s) => s.openError);
  const setCloneOpen = useRemotesUi((s) => s.setCloneOpen);
  const { openInit, openWorkspace } = useHomeDialogs();

  const knownRepos = useMemo(() => known.data ?? [], [known.data]);
  const recentRepos = useMemo<KnownRepo[]>(
    () =>
      (recent.data ?? []).slice(0, 10).map((r) => ({
        ...r,
        exists: knownRepos.find((k) => k.path === r.path)?.exists ?? true,
      })),
    [recent.data, knownRepos],
  );
  const workspaces = settings.workspaces;

  return (
    <div className="relative isolate flex min-h-0 flex-1 bg-bg">
      {settings.backdrop && <MeshBackdrop intensity="page" />}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Home</h1>
            <p className="text-base text-fg-muted">
              Open, clone or create a repository, or jump back into recent work.
            </p>
          </header>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-danger/40 bg-surface px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {canPickFolder && (
              <Button variant="primary" onClick={() => void pickAndOpen()}>
                <FolderOpen />
                Open folder
              </Button>
            )}
            <Button
              variant={canPickFolder ? "secondary" : "primary"}
              onClick={() => setCloneOpen(true)}
            >
              <CopyPlus />
              Clone
            </Button>
            {canPickFolder && !readOnly && (
              <Button variant="secondary" onClick={openInit}>
                <FolderPlus />
                Create repository
              </Button>
            )}
            <Button variant="secondary" onClick={() => openWorkspace({ mode: "create" })}>
              <LayoutGrid />
              New workspace
            </Button>
            <Button variant="secondary" onClick={() => openSettings("integrations")}>
              <Plug />
              Integrations
            </Button>
          </div>
          {workspaces.length > 0 && (
            <WorkspacesSection workspaces={workspaces} known={knownRepos} />
          )}
          <RepoCard label="Recently opened" heading="Recent">
            <RecentList repos={recentRepos} onOpen={(p) => void openPath(p)} />
          </RepoCard>
          <RepoCard label="All repositories" heading="All repositories">
            <KnownList repos={knownRepos} onOpen={(p) => void openPath(p)} />
          </RepoCard>
        </div>
      </div>
    </div>
  );
}

function WorkspacesSection({ workspaces, known }: { workspaces: Workspace[]; known: KnownRepo[] }) {
  const client = useQueryClient();
  const { openWorkspace } = useHomeDialogs();
  const [deleting, setDeleting] = useState<Workspace | null>(null);

  /** Opens every path in order; missing or failing paths are reported in one toast. */
  const openAll = async (ws: Workspace) => {
    const failed: string[] = [];
    for (const path of ws.repos) {
      if (known.find((k) => k.path === path)?.exists === false) {
        failed.push(path);
        continue;
      }
      try {
        useRepoStore.getState().addRepo(await unwrap(commands.repoOpen(path)));
      } catch {
        failed.push(path);
      }
    }
    void invalidateRepoLists(client);
    if (failed.length > 0) toast.error(`Could not open: ${failed.join(", ")}`);
  };

  return (
    <section aria-label="Workspaces" className="flex flex-col gap-2">
      <h2 className="text-base font-medium text-fg">Workspaces</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {workspaces.map((ws) => (
          <li
            key={ws.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-base text-fg">{ws.name}</span>
              <span className="text-xs text-fg-subtle">
                {ws.repos.length} {ws.repos.length === 1 ? "repository" : "repositories"}
              </span>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void openAll(ws)}>
              Open all
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label={`Actions for ${ws.name}`} size="sm">
                  <MoreVertical />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openWorkspace({ mode: "edit", id: ws.id })}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem destructive onSelect={() => setDeleting(ws)}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={`Delete workspace "${deleting?.name ?? ""}"?`}
        description="The repositories themselves are not touched; only the workspace is removed."
        confirmLabel="Delete"
        onConfirm={() => {
          if (!deleting) return;
          void updateSettings({ workspaces: workspaces.filter((w) => w.id !== deleting.id) }).then(
            (r) => {
              if (!r.ok) toast.error(r.message);
            },
          );
        }}
      />
    </section>
  );
}
