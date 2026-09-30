import { useState } from "react";
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
  SegmentedControl,
} from "@/design/components";
import { useRemotes } from "@/ipc/queries";
import { useRemotesUi } from "@/stores/remotes";
import { pushTo } from "./actions";

function Form({
  repoId,
  branch,
  onClose,
}: {
  repoId: string;
  branch: string;
  onClose: () => void;
}) {
  const remotes = useRemotes(repoId);
  const list = remotes.data ?? [];
  const setAddRemoteFor = useRemotesUi((s) => s.setAddRemoteFor);
  const [remote, setRemote] = useState<string | null>(null);
  const [remoteBranch, setRemoteBranch] = useState(branch);
  const chosen = remote ?? (list.find((r) => r.name === "origin") ?? list[0])?.name ?? "";

  const submit = () => {
    if (!chosen || !remoteBranch.trim()) return;
    void pushTo(repoId, {
      remote: chosen,
      branch,
      remoteBranch: remoteBranch.trim(),
      setUpstream: true,
      forceWithLease: false,
    });
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Push {branch}</DialogTitle>
        <DialogDescription>
          This branch has no upstream. Choose where to push it; it will track the new branch.
        </DialogDescription>
      </DialogHeader>
      {remotes.isSuccess && list.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-base text-fg-muted">This repository has no remotes yet.</p>
          <DialogFooter>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                setAddRemoteFor(repoId);
              }}
            >
              Add remote
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label>Remote</Label>
            <SegmentedControl
              aria-label="Remote"
              className="flex-wrap self-start"
              value={chosen}
              onValueChange={setRemote}
              options={list.map((r) => ({ value: r.name, label: r.name }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="push-branch">Remote branch</Label>
            <Input
              id="push-branch"
              value={remoteBranch}
              onChange={(e) => setRemoteBranch(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!chosen || !remoteBranch.trim()}>
              Push and set upstream
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}

/** "Push and set upstream" for branches that track nothing yet. */
export function PushDialog() {
  const state = useRemotesUi((s) => s.pushDialog);
  const setPushDialog = useRemotesUi((s) => s.setPushDialog);
  const branch = state?.branch ?? null;
  const close = () => setPushDialog(null);
  return (
    <Dialog open={state !== null && branch !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        {state && branch && (
          <Form
            key={`${state.repoId}/${branch}`}
            repoId={state.repoId}
            branch={branch}
            onClose={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
