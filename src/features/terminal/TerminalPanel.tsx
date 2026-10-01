import { RotateCw, SquareTerminal, Trash2, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePlatform } from "@/app/platform";
import { Button, EmptyState, IconButton, Tooltip } from "@/design/components";
import { useLayoutStore } from "@/stores/layout";
import { useRepoStore } from "@/stores/repo";
import {
  ensureOpened,
  getSession,
  killSession,
  openBackend,
  restartSession,
  subscribeSession,
  syncSize,
  type Session,
} from "./sessions";

export function TerminalPanel({ repoId, cwd }: { repoId: string; cwd: string }) {
  const { supportsTerminal } = usePlatform();
  const known = useRepoStore((s) => s.repos.some((r) => r.id === repoId));
  if (!known) return null;
  if (!supportsTerminal) {
    return (
      <div data-testid="terminal-panel" className="flex h-full items-center justify-center p-4">
        <EmptyState
          icon={<SquareTerminal />}
          title="Terminal unavailable"
          description="The integrated terminal is not supported on this platform."
        />
      </div>
    );
  }
  return <TerminalView repoId={repoId} cwd={cwd} />;
}

function TerminalView({ repoId, cwd }: { repoId: string; cwd: string }) {
  const session = getSession(repoId, cwd);
  const containerRef = useRef<HTMLDivElement>(null);
  const repoName = useRepoStore((s) => s.repos.find((r) => r.id === repoId)?.name ?? "");
  useSyncExternalStore(
    (cb) => subscribeSession(session, cb),
    () => session.version,
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.appendChild(session.host);
    ensureOpened(session);
    syncSize(session);
    if (!session.id && !session.opening && !session.exited && !session.error) {
      void openBackend(session);
    }
    session.term.focus();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => syncSize(session), 50);
    });
    observer.observe(container);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      // The session (and its process) outlives the panel; only detach the host.
      if (session.host.parentNode === container) container.removeChild(session.host);
    };
  }, [session]);

  return (
    <div
      data-testid="terminal-panel"
      className="flex h-full min-h-0 flex-col bg-terminal"
      onKeyDown={(e) => {
        // Escape belongs to the shell (vim, readline); do not let it close panels.
        if (e.key === "Escape") e.stopPropagation();
      }}
    >
      <Header session={session} repoName={repoName} />
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className="h-full w-full px-2 py-1"
          onMouseDown={() => session.term.focus()}
        />
        {session.error ? (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface p-4 text-center"
          >
            <p className="text-base text-danger">{session.error}</p>
            <Button size="sm" onClick={() => void openBackend(session)}>
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Header({ session, repoName }: { session: Session; repoName: string }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-panel-header pr-1 pl-3">
      <span className="text-sm font-semibold text-fg">Terminal</span>
      <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{repoName}</span>
      <Tooltip content="Restart terminal">
        <IconButton
          size="sm"
          aria-label="Restart terminal"
          onClick={() => void restartSession(session)}
        >
          <RotateCw />
        </IconButton>
      </Tooltip>
      <Tooltip content="Kill terminal">
        <IconButton size="sm" aria-label="Kill terminal" onClick={() => void killSession(session)}>
          <Trash2 />
        </IconButton>
      </Tooltip>
      <Tooltip content="Hide panel">
        <IconButton
          size="sm"
          aria-label="Hide panel"
          onClick={() => useLayoutStore.getState().setVisible("bottom", false)}
        >
          <X />
        </IconButton>
      </Tooltip>
    </div>
  );
}
