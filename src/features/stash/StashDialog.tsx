import { useState } from "react";
import {
  Button,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  Input,
  Label,
  Switch,
  toast,
} from "@/design/components";
import { useStashSave } from "@/ipc/queries";
import { errorMessage, useOutcomeToast } from "@/features/staging/ops";
import { useRepoStore } from "@/stores/repo";

function StashForm({ repoId, onDone }: { repoId: string; onDone: () => void }) {
  const save = useStashSave(repoId);
  const notify = useOutcomeToast(repoId);
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [keepIndex, setKeepIndex] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    save
      .mutateAsync({ message: message.trim() || null, includeUntracked, keepIndex })
      .then((outcome) => {
        notify(outcome, "Changes stashed");
        onDone();
      })
      .catch((e: unknown) => {
        setError(errorMessage(e));
        toast.error(`Could not stash: ${errorMessage(e)}`);
      });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="stash-message">Message</Label>
        <Input
          id="stash-message"
          value={message}
          placeholder="Optional message"
          autoFocus
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-base">
        <Switch
          checked={includeUntracked}
          onCheckedChange={setIncludeUntracked}
          aria-label="Include untracked files"
        />
        Include untracked files
      </label>
      <label className="flex items-center gap-2 text-base">
        <Switch
          checked={keepIndex}
          onCheckedChange={setKeepIndex}
          aria-label="Keep staged changes"
        />
        Keep staged changes in the index
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <ResponsiveDialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Stash changes
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

/** "Stash changes" dialog, opened through `useRepoStore().setStashDialog(repoId, true)`. */
export function StashDialog({ repoId }: { repoId: string }) {
  const open = useRepoStore((s) => s.stashDialog[repoId] ?? false);
  const setOpen = useRepoStore((s) => s.setStashDialog);
  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => setOpen(repoId, o)}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Stash changes</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Save your uncommitted changes and clean the working tree.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <StashForm repoId={repoId} onDone={() => setOpen(repoId, false)} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
