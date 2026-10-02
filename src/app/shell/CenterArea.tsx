import { lazy, Suspense, useEffect, useRef, type KeyboardEvent } from "react";
import { Spinner } from "@/design/components";
import { ForgeMainView } from "@/features/forge/ForgeMainView";
import { PullMainView } from "@/features/forge/pulls/PullMainView";
import { GraphView } from "@/features/graph/GraphView";
import { FileDiffView } from "@/features/repo/FileDiffView";
import { effectiveOpen } from "@/features/staging/effectiveOpen";
import { useStatus } from "@/ipc/queries";
import { useLayoutStore } from "@/stores/layout";
import { openWorktreeDiff, showGraph, useCenterView, useWorkspaceStore } from "@/stores/workspace";
import { CenterHeader } from "./CenterHeader";

// The diff library (with syntax highlighting) is large: load it when a diff is first opened.
const DiffViewer = lazy(() =>
  import("@/features/staging/diff/DiffViewer").then((m) => ({ default: m.DiffViewer })),
);

const spinner = (
  <div className="flex justify-center p-4">
    <Spinner />
  </div>
);

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/** The graph, or a diff / issue view in its place. The graph stays mounted while hidden. */
export function CenterArea({ repoId }: { repoId: string }) {
  const view = useCenterView(repoId);
  const status = useStatus(repoId).data;
  const rootRef = useRef<HTMLDivElement>(null);
  const prevKind = useRef(view.kind);

  // A working-copy file follows its change between sides, and leaves when it no longer changes.
  const resolved =
    view.kind === "worktreeDiff" && status
      ? effectiveOpen({ path: view.path, staged: view.staged }, status)
      : undefined;
  const worktreeGone = view.kind === "worktreeDiff" && resolved === null;
  const flipTo =
    view.kind === "worktreeDiff" && resolved && resolved.staged !== view.staged ? resolved : null;
  useEffect(() => {
    if (worktreeGone) showGraph(repoId);
    else if (flipTo) openWorktreeDiff(repoId, flipTo.path, flipTo.staged);
  }, [repoId, worktreeGone, flipTo]);

  // Back to the graph: focus its grid.
  useEffect(() => {
    if (prevKind.current !== "graph" && view.kind === "graph") {
      rootRef.current?.querySelector<HTMLElement>('[aria-label="Commit graph"]')?.focus();
    }
    prevKind.current = view.kind;
  }, [view.kind]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || view.kind === "graph") return;
    if (isTyping(e.target)) return;
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    e.preventDefault();
    useWorkspaceStore.getState().back(repoId);
  };

  const shown =
    view.kind === "worktreeDiff" && resolved ? { ...view, staged: resolved.staged } : view;

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className="flex h-full min-h-0 flex-col"
      data-testid="center-area"
    >
      <div hidden={view.kind !== "graph"} className="h-full min-h-0">
        <GraphView
          repoId={repoId}
          onOpenDetails={() => {
            useLayoutStore.getState().setVisible("right", true);
            window.setTimeout(() => document.getElementById("commit-details")?.focus(), 0);
          }}
        />
      </div>
      {shown.kind !== "graph" && <CenterHeader repoId={repoId} view={shown} />}
      {shown.kind === "commitDiff" && (
        <div className="min-h-0 flex-1 bg-surface">
          <FileDiffView repoId={repoId} oid={shown.oid} path={shown.path} />
        </div>
      )}
      {shown.kind === "worktreeDiff" && (
        <div className="min-h-0 flex-1 bg-surface">
          <Suspense fallback={spinner}>
            <DiffViewer
              key={`${shown.staged ? "s" : "u"}:${shown.path}`}
              repoId={repoId}
              path={shown.path}
              staged={shown.staged}
            />
          </Suspense>
        </div>
      )}
      {(shown.kind === "issues" || shown.kind === "issue" || shown.kind === "newIssue") && (
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          <ForgeMainView repoId={repoId} view={shown} />
        </div>
      )}
      {(shown.kind === "pulls" || shown.kind === "pull") && (
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          <PullMainView repoId={repoId} view={shown} />
        </div>
      )}
    </div>
  );
}
