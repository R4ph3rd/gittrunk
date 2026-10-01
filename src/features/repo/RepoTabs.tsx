import { GitBranch, Plus, X } from "lucide-react";
import { IconButton, Tooltip } from "@/design/components";
import { LayoutToggles } from "@/app/shell/LayoutToggles";
import { usePlatform } from "@/app/platform";
import { formatShortcut } from "@/app/shortcuts";
import { cn } from "@/lib/cn";
import { useRepoStore } from "@/stores/repo";
import { useCloseRepo, useOpenRepo } from "./useOpenRepo";

/** Top strip: brand, browser-style tabs (the active one merges into the toolbar row), layout toggles. */
export function RepoTabs() {
  const repos = useRepoStore((s) => s.repos);
  const activeId = useRepoStore((s) => s.activeId);
  const setActive = useRepoStore((s) => s.setActive);
  const error = useRepoStore((s) => s.openError);
  const { pickAndOpen } = useOpenRepo();
  const close = useCloseRepo();
  const { canPickFolder } = usePlatform();

  return (
    <header className="flex h-9 shrink-0 items-end gap-2 bg-tabbar pl-3 pr-2">
      <div className="flex h-full items-center gap-2">
        <GitBranch className="size-4 text-accent" aria-hidden />
        <span className="mr-1 text-sm font-medium tracking-tight">gittrunk</span>
      </div>
      <div
        role="tablist"
        aria-label="Open repositories"
        className="flex h-full min-w-0 items-end gap-0.5"
      >
        {repos.map((r) => {
          const active = r.id === activeId;
          return (
            <div
              key={r.id}
              className={cn(
                "relative flex h-8 items-center gap-1 rounded-t-md pl-3 pr-1 text-sm",
                active ? "bg-tab-active text-fg" : "text-fg-muted hover:bg-tab-hover",
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-0.5 rounded-t-md"
                  style={{ background: "var(--accent)" }}
                />
              )}
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActive(r.id)}
                title={r.path}
                className="max-w-40 truncate rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
              >
                {r.name}
              </button>
              <button
                type="button"
                aria-label={`Close ${r.name}`}
                onClick={() => void close(r.id)}
                className="rounded-sm p-0.5 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        {canPickFolder ? (
          <div className="flex h-8 items-center pl-1">
            <Tooltip content="Open repository" shortcut={formatShortcut("mod+o")}>
              <IconButton size="sm" aria-label="Open repository" onClick={() => void pickAndOpen()}>
                <Plus />
              </IconButton>
            </Tooltip>
          </div>
        ) : null}
      </div>
      {error && repos.length > 0 && (
        <span role="alert" className="mb-2 ml-2 truncate text-sm text-danger">
          {error}
        </span>
      )}
      <div className="ml-auto flex h-full items-center">{activeId ? <LayoutToggles /> : null}</div>
    </header>
  );
}
