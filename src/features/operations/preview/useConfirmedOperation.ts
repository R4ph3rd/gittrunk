import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "@/design/components";
import { commands, type OpOutcome } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateEverything } from "@/ipc/queries";
import { useDndStore } from "@/stores/dnd";
import { useRepoStore } from "@/stores/repo";
import type { OperationSpec } from "../actions/types";
import { getConfirmDestructive } from "./settings";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reverts the last operation through the oplog, then refreshes the repo. */
export async function undoLast(client: QueryClient, repoId: string): Promise<void> {
  try {
    await unwrap(commands.undo(repoId, false));
    toast.success("Undone");
  } catch (e) {
    toast.error(`Undo failed: ${errorMessage(e)}`);
  } finally {
    await invalidateEverything(client, repoId);
  }
}

/** Reports the result of a real (non dry-run) execution. */
export function reportOutcome(
  client: QueryClient,
  spec: Pick<OperationSpec, "repoId" | "successMessage">,
  outcome: OpOutcome,
): void {
  if (outcome.kind === "preview") return;
  const undo = { label: "Undo", onClick: () => void undoLast(client, spec.repoId) };
  if (outcome.kind === "conflicted") {
    toast.warning("Resolve conflicts to continue", {
      description: `${outcome.files.length} file(s) in conflict`,
      action: undo,
    });
    useRepoStore.getState().selectWip(spec.repoId);
  } else {
    toast.success(outcome.message || spec.successMessage || "Done", { action: undo });
  }
}

/** Runs the operation for real and reports success, conflicts or the error. */
export async function executeOperation(client: QueryClient, spec: OperationSpec): Promise<void> {
  try {
    const outcome = await spec.run(false);
    await invalidateEverything(client, spec.repoId);
    reportOutcome(client, spec, outcome);
  } catch (e) {
    await invalidateEverything(client, spec.repoId);
    toast.error(`${spec.confirmLabel} failed: ${errorMessage(e)}`);
  }
}

/**
 * Dry-runs the operation, asks for confirmation (always when commits would be dropped, conflicts
 * are predicted or the backend warns; otherwise per the `confirmDestructive` setting), then executes.
 */
export async function requestOperation(client: QueryClient, spec: OperationSpec): Promise<void> {
  let outcome: OpOutcome;
  try {
    outcome = await spec.run(true);
  } catch (e) {
    toast.error(`Cannot ${spec.confirmLabel.toLowerCase()}: ${errorMessage(e)}`);
    return;
  }
  if (outcome.kind !== "preview") {
    await invalidateEverything(client, spec.repoId);
    reportOutcome(client, spec, outcome);
    return;
  }
  const p = outcome.preview;
  const forced =
    p.commitsDropped.length > 0 || p.predictedConflicts.length > 0 || p.warnings.length > 0;
  if ((spec.confirm !== false && getConfirmDestructive()) || forced) {
    useDndStore.getState().setConfirm({ spec, preview: p });
  } else {
    await executeOperation(client, spec);
  }
}

export function useConfirmedOperation(): (spec: OperationSpec) => Promise<void> {
  const client = useQueryClient();
  return useCallback((spec) => requestOperation(client, spec), [client]);
}
