import { lazy, Suspense, useState } from "react";
import { Archive, CheckCircle2 } from "lucide-react";
import {
  Button,
  EmptyState,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Spinner,
} from "@/design/components";
import { useStatus } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { CommitBox } from "./CommitBox";
import { FileList, type OpenFile } from "./FileList";
import { effectiveOpen } from "./effectiveOpen";

// The diff library (with syntax highlighting) is large: load it when a diff is first opened.
const DiffViewer = lazy(() => import("./diff/DiffViewer").then((m) => ({ default: m.DiffViewer })));

/** Right-hand panel while the WIP row is selected: file lists, diff viewer and commit box. */
export function StagingPanel({ repoId }: { repoId: string }) {
  const status = useStatus(repoId);
  const setStashDialog = useRepoStore((s) => s.setStashDialog);
  const [rawOpen, setOpen] = useState<OpenFile | null>(null);

  const data = status.data;
  const open = data ? effectiveOpen(rawOpen, data) : null;
  const changes = data ? data.staged.length + data.unstaged.length + data.conflicted.length : 0;

  return (
    <aside
      id="commit-details"
      tabIndex={-1}
      aria-label="Working copy"
      className="flex h-full min-h-0 flex-col bg-surface outline-none"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="font-mono text-sm font-semibold text-accent">{"// WIP"}</h2>
        {data && (
          <span className="text-xs text-fg-muted" data-testid="wip-counts">
            {data.staged.length} staged · {data.unstaged.length + data.conflicted.length} unstaged
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={changes === 0}
          onClick={() => setStashDialog(repoId, true)}
        >
          <Archive />
          Stash
        </Button>
      </header>
      {status.isError && (
        <p role="alert" className="p-3 text-sm text-danger">
          {status.error.message}
        </p>
      )}
      {!data && !status.isError && (
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      )}
      {data && changes === 0 && (
        <EmptyState
          className="m-3 flex-1"
          icon={<CheckCircle2 />}
          title="Working tree clean"
          description="No uncommitted changes. Amend below to reword the last commit."
        />
      )}
      {data && changes > 0 && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* One stable tree so the file list keeps its selection while a diff opens or closes. */}
          <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
            <ResizablePanel id="files" minSize="15%">
              <div className="flex h-full min-h-0 flex-col">
                <FileList repoId={repoId} status={data} open={open} onOpen={setOpen} />
              </div>
            </ResizablePanel>
            {open && (
              <>
                <ResizableHandle aria-label="Resize diff" />
                <ResizablePanel id="diff" defaultSize="65%" minSize="20%">
                  <Suspense
                    fallback={
                      <div className="flex justify-center p-4">
                        <Spinner />
                      </div>
                    }
                  >
                    <DiffViewer
                      key={`${open.staged ? "s" : "u"}:${open.path}`}
                      repoId={repoId}
                      path={open.path}
                      staged={open.staged}
                    />
                  </Suspense>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      )}
      <CommitBox repoId={repoId} stagedCount={data?.staged.length ?? 0} />
    </aside>
  );
}
