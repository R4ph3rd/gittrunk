import { AiHost, suggestConflictResolution } from "@/features/ai";
import { ConflictSuggestProvider } from "@/features/operations/conflicts/suggest";
import { useAiEnabled } from "@/ipc/queries";
import { OperationsProvider } from "@/features/operations/dnd/OperationsProvider";
import { HomeHost } from "@/features/home/HomeHost";
import { HomePage } from "@/features/home/HomePage";
import { RemotesHost } from "@/features/remotes/RemotesHost";
import { SettingsHost } from "@/features/settings";
import { RepoTabs } from "@/features/repo/RepoTabs";
import { RepoView } from "@/features/repo/RepoView";
import { StatusBar } from "@/features/repo/StatusBar";
import { Welcome } from "@/features/repo/Welcome";
import { useRepoStore } from "@/stores/repo";
import { useMemo } from "react";
import { CommandHost } from "./commands";
import { MobileShell } from "./layout/MobileShell";
import { useLayout } from "./layout/useLayout";
import { usePlatformEffects } from "./layout/usePlatformEffects";

/** Compact layouts get the single-pane mobile shell; regular layouts the desktop tree. */
export function App() {
  const { isCompact } = useLayout();
  usePlatformEffects();
  return isCompact ? <MobileShell /> : <DesktopShell />;
}

/** Desktop shell: tabs, the active repository (or welcome screen) and the status bar. */
function DesktopShell() {
  const activeId = useRepoStore((s) => s.activeId);
  const page = useRepoStore((s) => s.page);
  const aiEnabled = useAiEnabled();
  // Offered to the conflict resolver only while AI is enabled.
  const suggest = useMemo(
    () =>
      aiEnabled && activeId
        ? (file: { path: string }) => suggestConflictResolution(activeId, file.path)
        : undefined,
    [aiEnabled, activeId],
  );

  return (
    <div className="flex h-full flex-col bg-chrome">
      <RepoTabs />
      <main className="flex min-h-0 flex-1 flex-col">
        {activeId ? (
          // Stays mounted while Home or a new tab is shown so graph scroll, selection and
          // the terminal survive.
          <div hidden={page.kind !== "repo"} className="flex min-h-0 flex-1 flex-col">
            <ConflictSuggestProvider value={suggest}>
              <OperationsProvider>
                <RepoView key={activeId} repoId={activeId} />
              </OperationsProvider>
            </ConflictSuggestProvider>
          </div>
        ) : null}
        {page.kind === "home" ? (
          <HomePage />
        ) : page.kind === "newTab" || !activeId ? (
          <Welcome />
        ) : null}
      </main>
      <StatusBar />
      <CommandHost />
      <RemotesHost />
      <HomeHost />
      <SettingsHost />
      <AiHost />
    </div>
  );
}
