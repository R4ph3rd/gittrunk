import { useCallback, useState, type ReactNode } from "react";
import { AlertDialog, toast } from "@/design/components";
import type { LineSelection, OpOutcome, OpPreview } from "@/ipc/bindings";
import { useDiscardLines, useDiscardPaths, useUndo } from "@/ipc/queries";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Returns `notify(outcome, fallback)`: a success toast (or conflict warning) with an Undo action. */
export function useOutcomeToast(repoId: string) {
  const { mutateAsync: undo } = useUndo(repoId);
  return useCallback(
    (outcome: OpOutcome, fallback: string) => {
      if (outcome.kind === "preview") return;
      const action = {
        label: "Undo",
        onClick: () => {
          undo().then(
            () => toast.success("Undone"),
            (e: unknown) => toast.error(`Undo failed: ${errorMessage(e)}`),
          );
        },
      };
      if (outcome.kind === "conflicted") {
        toast.warning(`${fallback}: conflicts in ${outcome.files.length} file(s)`, { action });
      } else {
        toast.success(outcome.message || fallback, { action });
      }
    },
    [undo],
  );
}

export type DiscardTarget =
  { kind: "paths"; paths: string[] } | { kind: "lines"; selection: LineSelection };

function targetLabel(target: DiscardTarget): string[] {
  if (target.kind === "paths") return target.paths;
  const lines = target.selection.hunks.reduce((n, h) => n + (h.lines?.length ?? 0), 0);
  const whole = target.selection.hunks.some((h) => h.lines === null);
  return [
    `${target.selection.path} (${whole ? "whole hunk" : `${lines} line${lines === 1 ? "" : "s"}`})`,
  ];
}

/** Confirmation body: the backend summary, the affected files and any warnings. */
function discardPreview(preview: OpPreview, target: DiscardTarget) {
  return (
    <div className="flex flex-col gap-2">
      <p className="whitespace-pre-wrap text-fg">{preview.summary}</p>
      <ul aria-label="Changes to discard">
        {targetLabel(target).map((p) => (
          <li key={p} className="truncate">
            {p}
          </li>
        ))}
      </ul>
      {preview.warnings.map((w) => (
        <p key={w} className="text-warning">
          {w}
        </p>
      ))}
    </div>
  );
}

/**
 * Safe discard: dry-runs first, shows what will be lost, executes on confirm, then offers Undo.
 * Render `dialog` once next to the component that calls `request`.
 */
export function useDiscard(repoId: string): {
  request: (target: DiscardTarget) => Promise<void>;
  dialog: ReactNode;
} {
  const discardPaths = useDiscardPaths(repoId);
  const discardLines = useDiscardLines(repoId);
  const notify = useOutcomeToast(repoId);
  const [pending, setPending] = useState<{ target: DiscardTarget; preview: OpPreview } | null>(
    null,
  );

  const run = useCallback(
    (target: DiscardTarget, dryRun: boolean) =>
      target.kind === "paths"
        ? discardPaths.mutateAsync({ paths: target.paths, dryRun })
        : discardLines.mutateAsync({ selection: target.selection, dryRun }),
    [discardPaths, discardLines],
  );

  const request = useCallback(
    async (target: DiscardTarget) => {
      try {
        const outcome = await run(target, true);
        if (outcome.kind === "preview") setPending({ target, preview: outcome.preview });
        else notify(outcome, "Changes discarded");
      } catch (e) {
        toast.error(`Could not prepare discard: ${errorMessage(e)}`);
      }
    },
    [run, notify],
  );

  const confirm = async () => {
    if (!pending) return;
    try {
      notify(await run(pending.target, false), "Changes discarded");
    } catch (e) {
      toast.error(`Discard failed: ${errorMessage(e)}`);
    }
  };

  const dialog = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title="Discard changes?"
      description="These uncommitted changes will be lost. You can undo right after."
      preview={pending ? discardPreview(pending.preview, pending.target) : null}
      confirmLabel="Discard"
      destructive
      onConfirm={() => void confirm()}
    />
  );

  return { request, dialog };
}
