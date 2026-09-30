import { useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Badge } from "@/design/components";
import type { OpPreview, RefUpdate } from "@/ipc/bindings";
import { useDndStore } from "@/stores/dnd";
import { MiniGraph } from "./MiniGraph";
import { shortRefName } from "./miniGraphModel";
import { executeOperation } from "./useConfirmedOperation";

const oid7 = (oid: string | null, empty: string) => (oid ? oid.slice(0, 7) : empty);

function RefUpdateRow({ update }: { update: RefUpdate }) {
  return (
    <li className="flex items-center gap-2">
      <span className="truncate font-semibold">{shortRefName(update.name)}</span>
      <span className="text-fg-muted">
        {oid7(update.from, "(new)")} {"→"} {oid7(update.to, "(deleted)")}
      </span>
    </li>
  );
}

/** Everything a dry run reports, as the body of a confirmation dialog. */
export function PreviewDetails({ preview }: { preview: OpPreview }) {
  return (
    <div className="flex flex-col gap-2" data-testid="preview-details">
      {preview.refUpdates.length > 0 && (
        <ul aria-label="Ref updates">
          {preview.refUpdates.map((u) => (
            <RefUpdateRow key={u.name} update={u} />
          ))}
        </ul>
      )}
      {preview.commitsCreated > 0 && (
        <p>
          Creates {preview.commitsCreated} commit{preview.commitsCreated === 1 ? "" : "s"}
        </p>
      )}
      {preview.commitsDropped.length > 0 && (
        <div>
          <Badge variant="danger">
            {preview.commitsDropped.length} commit{preview.commitsDropped.length === 1 ? "" : "s"}{" "}
            dropped
          </Badge>
          <ul aria-label="Commits dropped" className="mt-1">
            {preview.commitsDropped.map((c) => (
              <li key={c.oid} className="flex gap-2">
                <span className="text-fg-subtle">{c.shortOid}</span>
                <span className="truncate">{c.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.predictedConflicts.length > 0 && (
        <div>
          <Badge variant="danger">Conflicts predicted</Badge>
          <ul aria-label="Predicted conflicts" className="mt-1">
            {preview.predictedConflicts.map((f) => (
              <li key={f} className="truncate">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.warnings.map((w) => (
        <p key={w} className="text-warning">
          {w}
        </p>
      ))}
    </div>
  );
}

/** Confirmation dialog for the pending operation. Mount once (the provider does). */
export function OperationConfirmHost() {
  const client = useQueryClient();
  const pending = useDndStore((s) => s.confirm);
  const setConfirm = useDndStore((s) => s.setConfirm);
  const preview = pending?.preview;
  const danger =
    !!pending &&
    (pending.spec.destructive === true ||
      pending.preview.commitsDropped.length > 0 ||
      pending.preview.predictedConflicts.length > 0);
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setConfirm(null);
      }}
      title={pending?.spec.title ?? ""}
      description={
        preview ? (
          <>
            <span className="block whitespace-pre-wrap text-fg">{preview.summary}</span>
            <MiniGraph
              repoId={pending.spec.repoId}
              updates={preview.refUpdates}
              dropped={preview.commitsDropped}
            />
          </>
        ) : null
      }
      preview={preview ? <PreviewDetails preview={preview} /> : null}
      confirmLabel={pending?.spec.confirmLabel ?? "Confirm"}
      destructive={danger}
      onConfirm={() => {
        if (pending) void executeOperation(client, pending.spec);
      }}
    />
  );
}
