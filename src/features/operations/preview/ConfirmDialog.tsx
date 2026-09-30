import { useQueryClient } from "@tanstack/react-query";
import { useLayout } from "@/app/layout/useLayout";
import {
  AlertDialog,
  Badge,
  Button,
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/design/components";
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
  const { isCompact } = useLayout();
  const description = preview ? (
    <>
      <span className="block whitespace-pre-wrap text-fg">{preview.summary}</span>
      <MiniGraph
        repoId={pending.spec.repoId}
        updates={preview.refUpdates}
        dropped={preview.commitsDropped}
      />
    </>
  ) : null;
  const confirm = () => {
    if (pending) void executeOperation(client, pending.spec);
  };
  const close = (open: boolean) => {
    if (!open) setConfirm(null);
  };

  // Compact layouts: a full-height sheet with the whole preview and the buttons at the bottom.
  if (isCompact) {
    return (
      <ResponsiveDialog open={pending !== null} onOpenChange={close}>
        <ResponsiveDialogContent data-testid="confirm-sheet">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{pending?.spec.title ?? ""}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription asChild>
              <div className="text-base text-fg-muted">{description}</div>
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-2 text-base">
            {preview ? <PreviewDetails preview={preview} /> : null}
          </div>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ResponsiveDialogClose>
            <ResponsiveDialogClose asChild>
              <Button variant={danger ? "danger" : "primary"} onClick={confirm}>
                {pending?.spec.confirmLabel ?? "Confirm"}
              </Button>
            </ResponsiveDialogClose>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    );
  }
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={close}
      title={pending?.spec.title ?? ""}
      description={description}
      preview={preview ? <PreviewDetails preview={preview} /> : null}
      confirmLabel={pending?.spec.confirmLabel ?? "Confirm"}
      destructive={danger}
      onConfirm={confirm}
    />
  );
}
