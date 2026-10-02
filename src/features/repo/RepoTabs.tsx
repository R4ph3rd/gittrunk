import { GitBranch, Plus, Settings, X } from "lucide-react";
import { IconButton, Separator, Tooltip } from "@/design/components";
import { LayoutToggles } from "@/app/shell/LayoutToggles";
import { formatShortcut } from "@/app/shortcuts";
import { cn } from "@/lib/cn";
import { NotificationsButton } from "@/features/notifications/NotificationsButton";
import { openSettings } from "@/stores/settings";
import { useRepoStore } from "@/stores/repo";
import { useCloseRepo } from "./useOpenRepo";

/** Top strip: brand, browser-style tabs (the active one merges into the toolbar row), layout toggles. */
export function RepoTabs() {
  const repos = useRepoStore((s) => s.repos);
  const activeId = useRepoStore((s) => s.activeId);
  const setActive = useRepoStore((s) => s.setActive);
  const error = useRepoStore((s) => s.openError);
  const page = useRepoStore((s) => s.page);
  const newTabs = useRepoStore((s) => s.newTabs);
  const openNewTab = useRepoStore((s) => s.openNewTab);
  const closeNewTab = useRepoStore((s) => s.closeNewTab);
  const showHome = useRepoStore((s) => s.showHome);
  const close = useCloseRepo();
  const showToggles = activeId !== null && page.kind === "repo";

  return (
    <header className="flex h-9 shrink-0 items-end gap-2 bg-tabbar pl-3 pr-2">
      <div className="flex h-full items-center">
        <Tooltip content="Home">
          <button
            type="button"
            aria-label="Home"
            aria-current={page.kind === "home" ? "page" : undefined}
            onClick={showHome}
            className={cn(
              "flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-tab-hover focus-visible:outline-2 focus-visible:outline-accent",
              page.kind === "home" && "bg-tab-hover",
            )}
          >
            <GitBranch className="size-4 text-accent" aria-hidden />
            <span className="text-sm font-medium tracking-tight">gittrunk</span>
          </button>
        </Tooltip>
      </div>
      <div
        role="tablist"
        aria-label="Open repositories"
        className="flex h-full min-w-0 items-end gap-0.5"
      >
        {repos.map((r) => {
          const active = r.id === activeId && page.kind === "repo";
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
        {newTabs.map((id) => {
          const active = page.kind === "newTab" && page.id === id;
          return (
            <div
              key={id}
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
                onClick={() => useRepoStore.setState({ page: { kind: "newTab", id } })}
                className="max-w-40 truncate rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
              >
                New tab
              </button>
              <button
                type="button"
                aria-label="Close New tab"
                onClick={() => closeNewTab(id)}
                className="rounded-sm p-0.5 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        <div className="flex h-8 items-center pl-1">
          <Tooltip content="New tab" shortcut={formatShortcut("mod+t")}>
            <IconButton size="sm" aria-label="New tab" onClick={() => openNewTab()}>
              <Plus />
            </IconButton>
          </Tooltip>
        </div>
      </div>
      {error && repos.length > 0 && (
        <span role="alert" className="mb-2 ml-2 truncate text-sm text-danger">
          {error}
        </span>
      )}
      <div className="ml-auto flex h-full items-center gap-3">
        {showToggles && <LayoutToggles />}
        {showToggles && <Separator orientation="vertical" decorative={false} className="h-4" />}
        <div role="group" aria-label="Application" className="flex items-center gap-1">
          <NotificationsButton />
          <Tooltip content="Settings" shortcut={formatShortcut("mod+,")}>
            <IconButton size="sm" aria-label="Settings" onClick={() => openSettings()}>
              <Settings />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
