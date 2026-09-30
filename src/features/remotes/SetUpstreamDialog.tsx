import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  Label,
  toast,
} from "@/design/components";
import type { BranchInfo } from "@/ipc/bindings";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateAfterOp } from "@/ipc/queries";
import { NativeSelect } from "./NativeSelect";

function Form({
  repoId,
  branch,
  remoteBranches,
  onClose,
}: {
  repoId: string;
  branch: BranchInfo;
  remoteBranches: BranchInfo[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [value, setValue] = useState(branch.upstream ?? remoteBranches[0]?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => unwrap(commands.setUpstream(repoId, branch.name, value || null)),
    onSuccess: () => {
      void invalidateAfterOp(client, repoId);
      toast.success(
        value ? `${branch.name} now tracks ${value}` : `${branch.name} upstream removed`,
      );
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>Set upstream for {branch.name}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          Choose the remote branch this branch tracks.
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="upstream-branch">Upstream</Label>
          {/* Native select on purpose: the list of remote branches is unbounded, which a
              SegmentedControl cannot present; the native control gives search-by-typing. */}
          <NativeSelect
            id="upstream-branch"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">None (remove upstream)</option>
            {remoteBranches.map((b) => (
              <option key={b.fullName} value={b.name}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <ResponsiveDialogFooter>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Set upstream
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </>
  );
}

export function SetUpstreamDialog({
  repoId,
  branch,
  remoteBranches,
  onClose,
}: {
  repoId: string;
  branch: BranchInfo | null;
  remoteBranches: BranchInfo[];
  onClose: () => void;
}) {
  return (
    <ResponsiveDialog open={branch !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        {branch && (
          <Form repoId={repoId} branch={branch} remoteBranches={remoteBranches} onClose={onClose} />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
