import { useState } from "react";
import { GitMerge, MoreVertical } from "lucide-react";
import { ActionSheet, AlertDialog, Button, IconButton } from "@/design/components";
import { useRepoInfo, useStatus } from "@/ipc/queries";
import { useNav } from "@/stores/nav";
import { useOperationsStore } from "@/stores/operations";
import { canSkip, isSequencerState, stateTitle, useSequencerActions } from "./actions";

/** Phone variant of `OperationBanner`: state text, Resolve, and an overflow sheet. */
export function CompactBanner({ repoId }: { repoId: string }) {
  const info = useRepoInfo(repoId);
  const status = useStatus(repoId);
  const nav = useNav();
  const { run, pending } = useSequencerActions(repoId);
  const abortOpen = useOperationsStore((s) => s.abortConfirm[repoId] ?? false);
  const setAbortConfirm = useOperationsStore((s) => s.setAbortConfirm);
  const [sheet, setSheet] = useState(false);

  const state = info.data?.state ?? "clean";
  if (state === "clean") return null;

  const headName = info.data?.head.kind === "branch" ? info.data.head.name : null;
  const conflicted = status.data?.conflicted.length ?? 0;
  const sequencer = isSequencerState(state);
  const title = stateTitle(state, headName);

  return (
    <div
      role="region"
      aria-label="Operation in progress"
      data-state={state}
      className="sticky top-0 z-[var(--z-sticky)] flex shrink-0 items-center gap-2 border-b border-border bg-accent-muted px-3 py-1"
    >
      <GitMerge className="size-4 shrink-0 text-accent" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium" data-testid="operation-title">
          {title}
        </span>
        <span className={conflicted > 0 ? "text-xs text-danger" : "text-xs text-fg-muted"}>
          {conflicted > 0
            ? `${conflicted} conflicted file${conflicted === 1 ? "" : "s"}`
            : "No conflicts remaining"}
        </span>
      </div>
      {conflicted > 0 && (
        <Button size="sm" variant="primary" onClick={() => nav.push({ name: "conflicts" })}>
          Resolve
        </Button>
      )}
      {sequencer && (
        <IconButton aria-label="Operation actions" onClick={() => setSheet(true)}>
          <MoreVertical />
        </IconButton>
      )}
      <ActionSheet
        open={sheet}
        onOpenChange={setSheet}
        title={title}
        items={[
          {
            id: "continue",
            label: "Continue",
            disabled: pending || conflicted > 0,
            description: conflicted > 0 ? "Resolve all conflicts first" : undefined,
            onSelect: () => void run("continue"),
          },
          ...(canSkip(state)
            ? [{ id: "skip", label: "Skip", disabled: pending, onSelect: () => void run("skip") }]
            : []),
          {
            id: "abort",
            label: "Abort",
            destructive: true,
            disabled: pending,
            onSelect: () => setAbortConfirm(repoId, true),
          },
        ]}
      />
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
