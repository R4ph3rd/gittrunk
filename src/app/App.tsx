import { GitBranch } from "lucide-react";
import { useAppInfo } from "@/ipc/queries";

/** Phase 0 shell: gradient chrome, empty state, and a live IPC round-trip. */
export function App() {
  const info = useAppInfo();

  return (
    <div className="flex h-full flex-col bg-chrome">
      <header className="flex h-10 items-center gap-2 border-b border-border px-3">
        <GitBranch className="size-4 text-accent" aria-hidden />
        <span className="text-sm font-medium tracking-tight">gittrunk</span>
      </header>
      <main className="flex flex-1 items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Open a repository</h1>
          <p className="text-sm text-fg-muted">
            Repository browsing arrives in milestone 1. The backend connection is live below.
          </p>
          <p className="font-mono text-xs text-fg-subtle" data-testid="app-info">
            {info.data
              ? `v${info.data.version} · ${info.data.platform} · ${info.data.gitVersion ?? "git not found"}`
              : info.isError
                ? "backend unavailable"
                : "connecting…"}
          </p>
        </div>
      </main>
    </div>
  );
}
