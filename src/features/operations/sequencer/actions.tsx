import { useCallback } from "react";
import { toast } from "@/design/components";
import type { OpOutcome, RepoState, SequencerAction } from "@/ipc/bindings";
import { errorMessage, useOutcomeToast } from "@/features/staging/ops";
import { useSequencerControl } from "../queries";

/** Operations the sequencer can continue, skip or abort. */
export function isSequencerState(state: RepoState): boolean {
  return state !== "clean" && state !== "bisect" && state !== "applyMailbox";
}

/** Skip applies to commit-replaying operations only (not merges). */
export function canSkip(state: RepoState): boolean {
  return (
    state === "rebase" ||
    state === "rebaseInteractive" ||
    state === "cherryPick" ||
    state === "revert"
  );
}

/** Banner text. The contract carries no step counter or target names, so this is state-only. */
export function stateTitle(state: RepoState, headName: string | null): string {
  const onto = headName ? ` into ${headName}` : "";
  switch (state) {
    case "merge":
      return `Merging${onto}`;
    case "rebase":
    case "rebaseInteractive":
      return state === "rebase" ? "Rebasing" : "Interactive rebase in progress";
    case "cherryPick":
      return "Cherry-picking";
    case "revert":
      return "Reverting";
    case "bisect":
      return "Bisecting";
    case "applyMailbox":
      return "Applying patches";
    case "clean":
      return "";
  }
}

const VERB: Record<SequencerAction, string> = {
  continue: "Continued",
  skip: "Skipped",
  abort: "Aborted",
};

/**
 * Runs continue / skip / abort and reports the outcome: `applied` toasts (with Undo), a
 * `conflicted` outcome keeps the banner showing (queries are invalidated by the mutation).
 */
export function useSequencerActions(repoId: string) {
  const control = useSequencerControl(repoId);
  const notify = useOutcomeToast(repoId);
  const run = useCallback(
    async (action: SequencerAction): Promise<OpOutcome | null> => {
      try {
        const outcome = await control.mutateAsync(action);
        if (outcome.kind === "conflicted") {
          toast.warning(
            `Conflicts in ${outcome.files.length} file(s): resolve them, then continue`,
          );
        } else {
          notify(outcome, VERB[action]);
        }
        return outcome;
      } catch (e) {
        toast.error(`Could not ${action}: ${errorMessage(e)}`);
        return null;
      }
    },
    [control, notify],
  );
  return { run, pending: control.isPending };
}
