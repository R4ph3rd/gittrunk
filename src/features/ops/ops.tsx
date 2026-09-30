import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "@/design/components";
import { commands, events, type AppError, type OpFinishedPayload } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateAfterOp } from "@/ipc/queries";
import { useOpsStore, type OpKind } from "./store";

export interface RunOpSpec {
  kind: OpKind;
  repoId: string | null;
  /** Shown while running, e.g. "Fetching all remotes". */
  label: string;
  /** Shown in the success toast when the backend gives no message, e.g. "Fetch complete". */
  doneLabel: string;
  /** Starts the backend command and resolves to its `OpId` (throws on failure). */
  start: () => Promise<string>;
  /** Runs after a successful (or conflicted) finish. */
  onSuccess?: () => void | Promise<void>;
}

let queryClient: QueryClient | null = null;
/** Finish events that arrived before the command that started the op resolved. */
const early = new Map<string, OpFinishedPayload>();
const callbacks = new Map<string, RunOpSpec["onSuccess"]>();
let starting = 0;

function errorToast(title: string, error: AppError) {
  toast.error(`${title}: ${error.message}`, {
    description: error.detail ? (
      <details>
        <summary className="cursor-pointer">Details</summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs">
          {error.detail}
        </pre>
      </details>
    ) : undefined,
  });
}

/** Removes the op, refreshes the repo's queries and reports the outcome. */
export function finishOp(payload: OpFinishedPayload) {
  const op = useOpsStore.getState().ops[payload.opId];
  if (!op) {
    if (starting > 0) early.set(payload.opId, payload);
    return;
  }
  useOpsStore.getState().remove(op.id);
  const onSuccess = callbacks.get(op.id);
  callbacks.delete(op.id);
  if (op.repoId && queryClient) void invalidateAfterOp(queryClient, op.repoId);

  const { error, outcome } = payload;
  if (error) {
    if (error.kind !== "cancelled") errorToast(`${op.label} failed`, error);
    return;
  }
  if (outcome?.kind === "conflicted") {
    toast.warning(`${op.label}: conflicts in ${outcome.files.length} file(s)`);
  } else {
    toast.success(outcome?.kind === "applied" && outcome.message ? outcome.message : op.doneLabel);
  }
  void onSuccess?.();
}

/** Starts a long-running backend operation and tracks it until `op-finished`. */
export async function runOp(spec: RunOpSpec): Promise<string | null> {
  starting++;
  let id: string;
  try {
    id = await spec.start();
  } catch (err) {
    starting--;
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`${spec.label} failed: ${message}`);
    return null;
  }
  starting--;
  useOpsStore.getState().add({
    id,
    kind: spec.kind,
    repoId: spec.repoId,
    label: spec.label,
    doneLabel: spec.doneLabel,
  });
  callbacks.set(id, spec.onSuccess);
  const done = early.get(id);
  early.delete(id);
  if (done) finishOp(done);
  return id;
}

export function useRunOp() {
  return runOp;
}

export async function cancelOp(opId: string) {
  try {
    await unwrap(commands.opCancel(opId));
  } catch (err) {
    toast.error(`Could not cancel: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Subscribes once to `op-progress` and `op-finished`. Mount in the app shell. */
export function useOpEvents() {
  const client = useQueryClient();
  useEffect(() => {
    queryClient = client;
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const keep = (p: Promise<() => void>) =>
      void p.then((fn) => {
        if (cancelled) fn();
        else unlisteners.push(fn);
      });
    keep(events.opProgress.listen((e) => useOpsStore.getState().progress(e.payload)));
    keep(events.opFinished.listen((e) => finishOp(e.payload)));
    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
      if (queryClient === client) queryClient = null;
    };
  }, [client]);
}
