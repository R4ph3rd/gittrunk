import { AiHost, suggestConflictResolution } from "@/features/ai";
import { ConflictSuggestProvider } from "@/features/operations/conflicts/suggest";
import { useAiEnabled } from "@/ipc/queries";
import { OperationsProvider } from "@/features/operations/dnd/OperationsProvider";
import { RemotesHost } from "@/features/remotes/RemotesHost";
import { SettingsHost } from "@/features/settings";
import { RepoTabs } from "@/features/repo/RepoTabs";
import { RepoView } from "@/features/repo/RepoView";
import { StatusBar } from "@/features/repo/StatusBar";
import { Welcome } from "@/features/repo/Welcome";
import { useRepoStore } from "@/stores/repo";
import { useMemo } from "react";
import { CommandHost } from "./commands";

/** App shell: tabs, the active repository (or welcome screen) and the status bar. */
export function App() {
  const activeId = useRepoStore((s) => s.activeId);
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
          <ConflictSuggestProvider value={suggest}>
            <OperationsProvider>
              <RepoView key={activeId} repoId={activeId} />
            </OperationsProvider>
          </ConflictSuggestProvider>
        ) : (
          <Welcome />
        )}
      </main>
      <StatusBar />
      <CommandHost />
      <RemotesHost />
      <SettingsHost />
      <AiHost />
    </div>
  );
}
