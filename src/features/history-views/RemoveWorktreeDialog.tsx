import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@/design/components";
import { commands, type WorktreeInfo } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateSidebarLists } from "./queries";

/**
 * Confirms removing a worktree. `worktreeRemove` has no dry run, so this dialog is the preview:
 * it names the folder and warns about locks. A failed removal (e.g. local changes) offers force.
 */
export function RemoveWorktreeDialog({
  repoId,
  worktree,
  onClose,
}: {
  repoId: string;
  worktree: WorktreeInfo | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={worktree !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {worktree && <Body key={worktree.path} repoId={repoId} wt={worktree} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ repoId, wt, onClose }: { repoId: string; wt: WorktreeInfo; onClose: () => void }) {
  const client = useQueryClient();
  const [force, setForce] = useState(wt.locked);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(commands.worktreeRemove(repoId, wt.path, force));
      await invalidateSidebarLists(client, repoId);
      toast.success(`Removed worktree ${wt.path}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Local changes or a lock are the usual reasons: make the way out obvious.
      setForce(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Remove worktree?</DialogTitle>
        <DialogDescription>
          <span className="font-mono text-sm">{wt.path}</span> will be deleted from disk
          {wt.branch ? `. Branch ${wt.branch} is kept.` : "."}
        </DialogDescription>
      </DialogHeader>
      {wt.locked && <p className="mb-2 text-sm text-warning">This worktree is locked.</p>}
      <Checkbox
        checked={force}
        onCheckedChange={setForce}
        label="Force (discard uncommitted changes, ignore lock)"
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" loading={busy} onClick={() => void remove()}>
          Remove
        </Button>
      </DialogFooter>
    </>
  );
}
