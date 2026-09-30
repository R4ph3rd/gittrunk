import { useState, type ReactNode } from "react";
import { Activity, Search } from "lucide-react";
import { useCommandStore } from "@/app/commands";
import { AppBar, IconButton } from "@/design/components";
import { OpSheet } from "@/features/ops/OpSheet";
import { useOpProgress, useVisibleOps } from "@/features/ops/store";
import { OperationBanner } from "@/features/operations/sequencer/OperationBanner";
import type { RepoInfo } from "@/ipc/bindings";
import { NO_REPO, useNav } from "@/stores/nav";
import { useRepoStore } from "@/stores/repo";
import { RepoSwitcherSheet } from "./RepoSwitcherSheet";

export interface ShellAppBarProps {
  repoId: string | null;
  /** Default: repo switcher button (repo name + current branch subtitle). */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Shows Back, which calls `useNav().pop()`. */
  back?: boolean;
  actions?: ReactNode;
  /** Rendered under the bar (search fields). */
  children?: ReactNode;
}

function headText(head: RepoInfo["head"]): string {
  return head.kind === "detached" ? `detached ${head.oid.slice(0, 7)}` : head.name;
}

/**
 * Top bar of every mobile screen. Wires the top safe area, the op progress line (tap the
 * activity button to expand), the repo switcher sheet and the sequencer `OperationBanner`.
 */
export function ShellAppBar({
  repoId: repoIdProp,
  title,
  subtitle,
  back,
  actions,
  children,
}: ShellAppBarProps) {
  const nav = useNav();
  const repoId = repoIdProp === NO_REPO ? null : repoIdProp;
  const repo = useRepoStore((s) => s.repos.find((r) => r.id === repoId) ?? null);
  const progress = useOpProgress(repoId);
  const running = useVisibleOps(repoId);
  const [switcher, setSwitcher] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);

  const defaultTitle = title === undefined;
  return (
    <>
      <AppBar
        title={defaultTitle ? (repo?.name ?? "gittrunk") : title}
        subtitle={defaultTitle ? (subtitle ?? (repo ? headText(repo.head) : undefined)) : subtitle}
        {...(defaultTitle ? { onTitleClick: () => setSwitcher(true) } : {})}
        {...(back ? { onBack: () => void nav.pop() } : {})}
        progress={progress}
        actions={
          <>
            {actions}
            {running.length > 0 ? (
              <IconButton aria-label="Running operations" onClick={() => setOpsOpen(true)}>
                <Activity />
              </IconButton>
            ) : null}
            <IconButton
              aria-label="Command palette"
              onClick={() => useCommandStore.getState().setPaletteOpen(true)}
            >
              <Search />
            </IconButton>
          </>
        }
      >
        {children}
        {repoId ? <OperationBanner repoId={repoId} /> : null}
      </AppBar>
      <RepoSwitcherSheet open={switcher} onOpenChange={setSwitcher} />
      <OpSheet repoId={repoId} open={opsOpen} onOpenChange={setOpsOpen} />
    </>
  );
}
