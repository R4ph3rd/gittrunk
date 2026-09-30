import { RemotesHost } from "@/features/remotes/RemotesHost";
import { RepoTabs } from "@/features/repo/RepoTabs";
import { RepoView } from "@/features/repo/RepoView";
import { StatusBar } from "@/features/repo/StatusBar";
import { Welcome } from "@/features/repo/Welcome";
import { useRepoStore } from "@/stores/repo";
import { CommandHost } from "./commands";

/** App shell: tabs, the active repository (or welcome screen) and the status bar. */
export function App() {
  const activeId = useRepoStore((s) => s.activeId);

  return (
    <div className="flex h-full flex-col bg-chrome">
      <RepoTabs />
      <main className="flex min-h-0 flex-1 flex-col">
        {activeId ? <RepoView key={activeId} repoId={activeId} /> : <Welcome />}
      </main>
      <StatusBar />
      <CommandHost />
      <RemotesHost />
    </div>
  );
}
