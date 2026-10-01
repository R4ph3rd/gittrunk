import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/design/components";
import { commands, type RefsSnapshot } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateEverything } from "@/ipc/queries";
import { useDndStore } from "@/stores/dnd";
import { useRemotesUi } from "@/stores/remotes";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Dry-runs an undo or redo and opens the confirmation dialog with its preview. Shared by the
 * toolbar split button and the `history.undo` / `history.redo` commands.
 */
export async function requestOplogStep(
  client: QueryClient,
  repoId: string,
  mode: "undo" | "redo",
): Promise<void> {
  try {
    const outcome = await unwrap(
      mode === "redo" ? commands.redo(repoId, true) : commands.undo(repoId, true),
    );
    if (outcome.kind === "preview") {
      useRemotesUi.getState().setOplogPreview({ repoId, preview: outcome.preview, mode });
    } else {
      void invalidateEverything(client, repoId);
    }
  } catch (e) {
    toast.error(`Nothing to ${mode}: ${message(e)}`);
  }
}

/** Opens the branch name prompt for a new branch at HEAD; false when HEAD is unborn. */
export function promptBranchAtHead(repoId: string, refs: RefsSnapshot | undefined): boolean {
  const head = refs?.head;
  if (!head || head.kind === "unborn") return false;
  const label = head.kind === "branch" ? head.name : head.oid.slice(0, 7);
  useDndStore.getState().setPrompt({ kind: "branch", repoId, startPoint: head.oid, label });
  return true;
}
