import { useState } from "react";
import { Archive, FolderGit2, History, Settings, Sparkles, TerminalSquare } from "lucide-react";
import { useCommandStore } from "@/app/commands";
import { usePlatform } from "@/app/platform";
import { ListRow } from "@/design/components";
import { openAskAi } from "@/features/ai";
import { useAppInfo } from "@/ipc/queries";
import { useNav } from "@/stores/nav";
import { RepoSwitcherSheet } from "./RepoSwitcherSheet";
import { ShellAppBar } from "./ShellAppBar";
import type { TabScreenProps } from "./registry";

/** The More tab: secondary screens, actions, settings, repositories and About. */
export function MoreScreen({ repoId }: TabScreenProps) {
  const nav = useNav();
  const info = useAppInfo();
  const platform = usePlatform();
  const [switcher, setSwitcher] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar repoId={repoId} />
      <div
        data-scroll-root=""
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-surface"
      >
        <ListRow
          title="Stash"
          leading={<Archive className="size-4" />}
          chevron
          onClick={() => nav.push({ name: "stash" })}
        />
        <ListRow
          title="Reflog"
          leading={<History className="size-4" />}
          chevron
          onClick={() => nav.push({ name: "reflog", ref: null })}
        />
        <ListRow
          title="Ask AI"
          leading={<Sparkles className="size-4" />}
          chevron
          onClick={() => openAskAi(repoId)}
        />
        <ListRow
          title="Actions"
          subtitle="Command palette"
          leading={<TerminalSquare className="size-4" />}
          chevron
          onClick={() => useCommandStore.getState().setPaletteOpen(true)}
        />
        <ListRow
          title="Repositories"
          leading={<FolderGit2 className="size-4" />}
          chevron
          onClick={() => setSwitcher(true)}
        />
        <ListRow
          title="Settings"
          leading={<Settings className="size-4" />}
          chevron
          onClick={() => nav.push({ name: "settings" })}
        />
        <section aria-label="About" className="mt-2 border-t border-border px-3 py-3">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-fg-subtle">About</h2>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1 text-base">
            <dt className="text-fg-muted">Version</dt>
            <dd>{info.data?.version ?? "…"}</dd>
            <dt className="text-fg-muted">Git</dt>
            <dd>
              {platform.hasGitCli
                ? info.data
                  ? (info.data.gitVersion ?? "Not found on PATH")
                  : "…"
                : "Embedded libgit2"}
            </dd>
            <dt className="text-fg-muted">Platform</dt>
            <dd>{info.data?.platform ?? platform.os}</dd>
          </dl>
        </section>
      </div>
      <RepoSwitcherSheet open={switcher} onOpenChange={setSwitcher} />
    </div>
  );
}
