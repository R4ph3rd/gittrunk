import { useCallback, useState, type ReactNode } from "react";
import { AlertDialog, toast } from "@/design/components";
import type { OpPreview, StashEntry } from "@/ipc/bindings";
import { useStashApply, useStashDrop } from "@/ipc/queries";
import { errorMessage, useOutcomeToast } from "@/features/staging/ops";

export const stashLabel = (s: Pick<StashEntry, "index" | "message">) =>
  s.message || `stash@{${s.index}}`;

/**
 * Apply, pop and drop for stash entries. Drop dry-runs first and confirms; every success toast
 * carries Undo. Render `dialog` once next to the menu that calls these.
 */
export function useStashActions(repoId: string): {
  apply: (entry: StashEntry, pop: boolean) => Promise<void>;
  drop: (entry: StashEntry) => Promise<void>;
  dialog: ReactNode;
} {
  const applyMutation = useStashApply(repoId);
  const dropMutation = useStashDrop(repoId);
  const notify = useOutcomeToast(repoId);
  const [pending, setPending] = useState<{ entry: StashEntry; preview: OpPreview } | null>(null);

  const apply = useCallback(
    async (entry: StashEntry, pop: boolean) => {
      try {
        const outcome = await applyMutation.mutateAsync({ index: entry.index, pop });
        notify(outcome, pop ? "Stash popped" : "Stash applied");
      } catch (e) {
        toast.error(`Could not ${pop ? "pop" : "apply"} stash: ${errorMessage(e)}`);
      }
    },
    [applyMutation, notify],
  );

  const drop = useCallback(
    async (entry: StashEntry) => {
      try {
        const outcome = await dropMutation.mutateAsync({ index: entry.index, dryRun: true });
        if (outcome.kind === "preview") setPending({ entry, preview: outcome.preview });
        else notify(outcome, "Stash dropped");
      } catch (e) {
        toast.error(`Could not prepare drop: ${errorMessage(e)}`);
      }
    },
    [dropMutation, notify],
  );

  const confirm = async () => {
    if (!pending) return;
    try {
      const outcome = await dropMutation.mutateAsync({ index: pending.entry.index, dryRun: false });
      notify(outcome, "Stash dropped");
    } catch (e) {
      toast.error(`Could not drop stash: ${errorMessage(e)}`);
    }
  };

  const dialog = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title="Drop stash?"
      description="The stashed changes will be removed. You can undo right after."
      preview={
        pending ? (
          <div className="flex flex-col gap-1">
            <span className="text-fg">{stashLabel(pending.entry)}</span>
            <span className="whitespace-pre-wrap text-fg-muted">{pending.preview.summary}</span>
            {pending.preview.warnings.map((w) => (
              <span key={w} className="text-warning">
                {w}
              </span>
            ))}
          </div>
        ) : null
      }
      confirmLabel="Drop"
      destructive
      onConfirm={() => void confirm()}
    />
  );

  return { apply, drop, dialog };
}
