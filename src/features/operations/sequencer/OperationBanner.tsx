import { useState } from "react";
import { ChevronDown, ChevronRight, GitMerge } from "lucide-react";
import { AlertDialog, Button } from "@/design/components";
import { useRepoInfo, useStatus } from "@/ipc/queries";
import { useLayout } from "@/app/layout/useLayout";
import { useOperationsStore } from "@/stores/operations";
import { CompactBanner } from "./CompactBanner";
import { canSkip, isSequencerState, stateTitle, useSequencerActions } from "./actions";

/** Shown at the top of a repo view while a merge, rebase, cherry-pick or revert is in progress. */
function DesktopBanner({ repoId }: { repoId: string }) {
  const info = useRepoInfo(repoId);
  const status = useStatus(repoId);
  const { run, pending } = useSequencerActions(repoId);
  const openConflict = useOperationsStore((s) => s.openConflict);
  const abortOpen = useOperationsStore((s) => s.abortConfirm[repoId] ?? false);
  const setAbortConfirm = useOperationsStore((s) => s.setAbortConfirm);
  const [listOpen, setListOpen] = useState(true);

  const state = info.data?.state ?? "clean";
  if (state === "clean") return null;

  const headName = info.data?.head.kind === "branch" ? info.data.head.name : null;
  const conflicted = status.data?.conflicted ?? [];
  const sequencer = isSequencerState(state);
  const title = stateTitle(state, headName);

  return (
    <div
      role="region"
      aria-label="Operation in progress"
      data-state={state}
      className="shrink-0 border-b border-border bg-accent-muted"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        <GitMerge className="size-3.5 text-accent" aria-hidden />
        <span className="text-sm font-medium" data-testid="operation-title">
          {title}
        </span>
        {conflicted.length > 0 ? (
          <button
            type="button"
            aria-expanded={listOpen}
            onClick={() => setListOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-sm text-sm text-danger outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
          >
            {listOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {conflicted.length} conflicted file{conflicted.length === 1 ? "" : "s"}
          </button>
        ) : (
          <span className="text-sm text-fg-muted">No conflicts remaining</span>
        )}
        {sequencer && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={pending || conflicted.length > 0}
              title={conflicted.length > 0 ? "Resolve all conflicts first" : undefined}
              onClick={() => void run("continue")}
            >
              Continue
            </Button>
            {canSkip(state) && (
              <Button size="sm" disabled={pending} onClick={() => void run("skip")}>
                Skip
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => setAbortConfirm(repoId, true)}
            >
              Abort
            </Button>
          </div>
        )}
      </div>
      {listOpen && conflicted.length > 0 && (
        <ul aria-label="Conflicted files" className="flex flex-wrap gap-1 px-3 pb-1.5">
          {conflicted.map((f) => (
            <li key={f.path}>
              <Button
                size="xs"
                variant="outline"
                className="font-mono"
                onClick={() => openConflict(repoId, f.path)}
              >
                {f.path}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog
        open={abortOpen}
        onOpenChange={(open) => setAbortConfirm(repoId, open)}
        title={`Abort ${title.toLowerCase()}?`}
        description="Everything done so far in this operation, including your conflict resolutions, is discarded and the branch returns to how it was."
        confirmLabel="Abort operation"
        destructive
        onConfirm={() => void run("abort")}
      />
    </div>
  );
}

/** Banner under the AppBar: the desktop bar, or a sticky one-line bar with a sheet on compact. */
export function OperationBanner({ repoId }: { repoId: string }) {
  const { isCompact } = useLayout();
  return isCompact ? <CompactBanner repoId={repoId} /> : <DesktopBanner repoId={repoId} />;
}
