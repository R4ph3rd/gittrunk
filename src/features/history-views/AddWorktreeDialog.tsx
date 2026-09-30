import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
  toast,
} from "@/design/components";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { useRefs } from "@/ipc/queries";
import { invalidateSidebarLists } from "./queries";
import { openAsRepository } from "./openRepo";
import { validateWorktree, type WorktreeErrors } from "./validate";

export function AddWorktreeDialog({
  repoId,
  open,
  onClose,
}: {
  repoId: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{open && <Form repoId={repoId} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function Form({ repoId, onClose }: { repoId: string; onClose: () => void }) {
  const client = useQueryClient();
  const refs = useRefs(repoId);
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(true);
  const [errors, setErrors] = useState<WorktreeErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const browse = async () => {
    const picked = await pickFolder({ directory: true, multiple: false });
    if (typeof picked === "string") setPath(picked);
  };

  const submit = async () => {
    const found = validateWorktree(
      { path, branch, createBranch },
      (refs.data?.local ?? []).map((b) => b.name),
    );
    setErrors(found);
    setFailure(null);
    if (found.path || found.branch) return;
    setBusy(true);
    try {
      const wt = await unwrap(
        commands.worktreeAdd(repoId, {
          path: path.trim(),
          branch: branch.trim(),
          createBranch,
        }),
      );
      await invalidateSidebarLists(client, repoId);
      toast.success(`Added worktree ${wt.path}`, {
        action: { label: "Open", onClick: () => void openAsRepository(wt.path) },
      });
      onClose();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Add worktree</DialogTitle>
        <DialogDescription>
          Check out a branch in a separate folder, next to this repository.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="wt-path">Folder</Label>
          <div className="flex gap-2">
            <Input
              id="wt-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/path/to/new-worktree"
              aria-invalid={errors.path ? true : undefined}
              aria-describedby={errors.path ? "wt-path-error" : undefined}
              autoFocus
            />
            <Button type="button" onClick={() => void browse()}>
              Browse…
            </Button>
          </div>
          {errors.path && (
            <p id="wt-path-error" role="alert" className="text-sm text-danger">
              {errors.path}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="wt-branch">Branch</Label>
          <Input
            id="wt-branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder={createBranch ? "new-branch-name" : "existing-branch"}
            aria-invalid={errors.branch ? true : undefined}
            aria-describedby={errors.branch ? "wt-branch-error" : undefined}
          />
          {errors.branch && (
            <p id="wt-branch-error" role="alert" className="text-sm text-danger">
              {errors.branch}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch id="wt-create" checked={createBranch} onCheckedChange={setCreateBranch} />
          <Label htmlFor="wt-create">Create new branch</Label>
        </div>
        {failure && (
          <p role="alert" className="text-sm text-danger">
            {failure}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          Add worktree
        </Button>
      </DialogFooter>
    </form>
  );
}
