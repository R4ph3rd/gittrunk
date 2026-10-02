import { useMemo, useState, type ReactNode } from "react";
import { MoreVertical, Trash2 } from "lucide-react";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
} from "@/design/components";
import type { KnownRepo } from "@/ipc/bindings";
import { useForgetRepo } from "@/ipc/queries";
import { relativeDate } from "@/features/graph/format";
import { truncateMiddle } from "@/features/repo/recentPaths";

/** An opaque card holding a titled list; text on it never sits on the page gradient. */
export function RepoCard({
  label,
  heading,
  children,
}: {
  label: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h2 className="text-base font-medium text-fg">{heading}</h2>
      <div className="rounded-lg border border-border bg-surface p-1">{children}</div>
    </section>
  );
}

function RepoRow({
  repo,
  onOpen,
  actions,
}: {
  repo: KnownRepo;
  onOpen: (path: string) => void;
  actions?: ReactNode;
}) {
  const missing = !repo.exists;
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        disabled={missing}
        onClick={() => onOpen(repo.path)}
        title={repo.path}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base text-fg">{repo.name}</span>
          <span className="truncate font-mono text-xs text-fg-subtle">
            {truncateMiddle(repo.path)}
          </span>
        </span>
        {missing ? <Badge variant="warning">Missing</Badge> : null}
        {repo.lastOpened !== null && (
          <span className="shrink-0 text-xs text-fg-subtle">{relativeDate(repo.lastOpened)}</span>
        )}
      </button>
      {actions}
    </li>
  );
}

/** Up to 10 most recently opened repositories. */
export function RecentList({
  repos,
  onOpen,
}: {
  repos: KnownRepo[];
  onOpen: (path: string) => void;
}) {
  if (repos.length === 0) {
    return <p className="px-2 py-3 text-sm text-fg-subtle">No repositories opened yet.</p>;
  }
  return (
    <ul className="flex flex-col">
      {repos.slice(0, 10).map((r) => (
        <RepoRow key={r.path} repo={r} onOpen={onOpen} />
      ))}
    </ul>
  );
}

/** Every known repository with a filter (when long) and a per-row "Remove from list" menu. */
export function KnownList({
  repos,
  onOpen,
}: {
  repos: KnownRepo[];
  onOpen: (path: string) => void;
}) {
  const forget = useForgetRepo();
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [repos, filter]);

  if (repos.length === 0) {
    return (
      <EmptyState
        title="No repositories yet"
        description="Open a folder, clone or create a repository and it will be listed here."
        className="border-0"
      />
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {repos.length > 10 && (
        <div className="p-1">
          <Input
            aria-label="Filter repositories"
            placeholder="Filter repositories"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      <ul className="flex flex-col">
        {shown.map((r) => (
          <RepoRow
            key={r.path}
            repo={r}
            onOpen={onOpen}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton aria-label={`Actions for ${r.name}`} size="sm">
                    <MoreVertical />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem icon={<Trash2 />} onSelect={() => forget.mutate(r.path)}>
                    Remove from list
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        ))}
        {shown.length === 0 && <li className="px-2 py-3 text-sm text-fg-subtle">No matches.</li>}
      </ul>
    </div>
  );
}
