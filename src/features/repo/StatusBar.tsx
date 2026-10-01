import { OpIndicator } from "@/features/ops/OpIndicator";
import { useActiveRepo } from "@/stores/repo";
import { useAppInfo, useStatus } from "@/ipc/queries";

function RepoStatus({ repoId }: { repoId: string }) {
  const status = useStatus(repoId);
  if (!status.data) return null;
  const { staged, unstaged, conflicted } = status.data;
  return (
    <span data-testid="repo-status">
      {staged.length} staged · {unstaged.length} changed
      {conflicted.length > 0 ? ` · ${conflicted.length} conflicted` : ""}
    </span>
  );
}

export function StatusBar() {
  const info = useAppInfo();
  const repo = useActiveRepo();
  const head = repo?.head;
  const headText = !head
    ? null
    : head.kind === "branch"
      ? head.name
      : head.kind === "detached"
        ? `detached ${head.oid.slice(0, 7)}`
        : head.name;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-panel-header px-3 font-mono text-xs text-fg-subtle">
      {repo && headText && <span className="text-fg-muted">{headText}</span>}
      {repo && <RepoStatus repoId={repo.id} />}
      <OpIndicator repoId={repo?.id ?? null} />
      <span className="ml-auto" data-testid="app-info">
        {info.data
          ? `v${info.data.version} · ${info.data.platform} · ${info.data.gitVersion ?? "git not found"}`
          : info.isError
            ? "backend unavailable"
            : "connecting…"}
      </span>
    </footer>
  );
}
