import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  toast,
} from "@/design/components";
import { commands, type BranchInfo } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateAfterOp } from "@/ipc/queries";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Form({
  repoId,
  branches,
  onClose,
}: {
  repoId: string;
  branches: BranchInfo[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  /** Names the backend refuses to delete without force (commits not merged anywhere). */
  const [unmerged, setUnmerged] = useState<Set<string> | null>(null);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const risky = new Set<string>();
      for (const b of branches) {
        try {
          await unwrap(
            commands.branchDelete(repoId, { name: b.name, remote: false, force: false }, true),
          );
        } catch {
          risky.add(b.name);
        }
      }
      if (!cancelled) setUnmerged(risky);
    })();
    return () => {
      cancelled = true;
    };
  }, [repoId, branches]);

  const targets = branches.filter((b) => force || !unmerged?.has(b.name));

  const run = async () => {
    setBusy(true);
    let deleted = 0;
    const failed: string[] = [];
    for (const b of targets) {
      try {
        await unwrap(
          commands.branchDelete(
            repoId,
            { name: b.name, remote: false, force: force && (unmerged?.has(b.name) ?? false) },
            false,
          ),
        );
        deleted++;
      } catch (e) {
        failed.push(`${b.name}: ${message(e)}`);
      }
    }
    void invalidateAfterOp(client, repoId);
    if (deleted > 0) toast.success(`Deleted ${deleted} branch${deleted === 1 ? "" : "es"}`);
    if (failed.length > 0) toast.error(`Could not delete ${failed.join("; ")}`);
    setBusy(false);
    onClose();
  };

  const skipped = unmerged ? branches.length - targets.length : 0;
  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>Delete branches whose remote is gone</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          These local branches track a remote branch that was deleted. The checked-out branch is
          never deleted.
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ul aria-label="Branches to delete" className="max-h-60 overflow-y-auto font-mono text-sm">
        {branches.map((b) => (
          <li key={b.fullName} className="flex items-center gap-2 py-0.5">
            <span className="truncate">{b.name}</span>
            {unmerged?.has(b.name) && (
              <span className="shrink-0 text-xs text-warning">unpushed commits</span>
            )}
          </li>
        ))}
      </ul>
      {unmerged && unmerged.size > 0 && (
        <Checkbox
          checked={force}
          onCheckedChange={setForce}
          label={`Also delete ${unmerged.size} branch${unmerged.size === 1 ? "" : "es"} with unpushed commits`}
        />
      )}
      <ResponsiveDialogFooter>
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={unmerged === null || targets.length === 0}
          loading={busy}
          onClick={() => void run()}
        >
          {skipped > 0 && !force
            ? `Delete ${targets.length} (keep ${skipped})`
            : `Delete ${targets.length}`}
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}

export function GoneBranchesDialog({
  repoId,
  open,
  branches,
  onClose,
}: {
  repoId: string;
  open: boolean;
  branches: BranchInfo[];
  onClose: () => void;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        {open && <Form repoId={repoId} branches={branches} onClose={onClose} />}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
