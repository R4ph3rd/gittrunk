import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { usePlatform } from "@/app/platform";
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
  toast,
} from "@/design/components";
import { joinPath } from "@/features/remotes/validate";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateRepoLists } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { useHomeDialogs } from "./store";

function validateFolderName(name: string): string | null {
  if (name.trim() === "") return "Enter a name";
  if (/[/\\]/.test(name) || name.includes("..")) return "The name cannot contain / \\ or ..";
  return null;
}

function validateBranchName(branch: string): string | null {
  if (branch === "") return "Enter a branch name";
  if (/\s/.test(branch)) return "The branch name cannot contain spaces";
  if (branch.startsWith("-")) return "The branch name cannot start with a dash";
  if (branch.includes("..")) return "The branch name cannot contain ..";
  return null;
}

function Form({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const { defaultReposDir } = usePlatform();
  const [parent, setParent] = useState(defaultReposDir ?? "");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parentError = parent.trim() === "" ? "Choose a location" : null;
  const nameError = validateFolderName(name);
  const branchError = validateBranchName(branch);
  const path = joinPath(parent.trim(), name.trim());

  const browse = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") setParent(picked);
  };

  const submit = async () => {
    setTouched(true);
    if (parentError || nameError || branchError) return;
    setBusy(true);
    setError(null);
    try {
      const info = await unwrap(commands.repoInit({ path, bare: false, initialBranch: branch }));
      useRepoStore.getState().addRepo(info);
      void invalidateRepoLists(client);
      toast.success(`Created ${name.trim()}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (msg: string | null) => (touched && msg ? "true" : undefined);
  const fieldError = (msg: string | null) =>
    touched && msg ? (
      <p role="alert" className="text-sm text-danger">
        {msg}
      </p>
    ) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create repository</DialogTitle>
        <DialogDescription>Initialize a new git repository in a new folder.</DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="init-location">Location</Label>
          <div className="flex gap-2">
            <Input
              id="init-location"
              value={parent}
              placeholder="Parent folder"
              aria-invalid={field(parentError)}
              onChange={(e) => setParent(e.target.value)}
            />
            <Button type="button" onClick={() => void browse()}>
              <FolderOpen />
              Browse…
            </Button>
          </div>
          {fieldError(parentError)}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="init-name">Name</Label>
          <Input
            id="init-name"
            value={name}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            aria-invalid={field(nameError)}
            onChange={(e) => setName(e.target.value)}
          />
          {fieldError(nameError)}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="init-branch">Initial branch</Label>
          <Input
            id="init-branch"
            value={branch}
            autoCapitalize="none"
            autoCorrect="off"
            aria-invalid={field(branchError)}
            onChange={(e) => setBranch(e.target.value)}
          />
          {fieldError(branchError)}
        </div>
        <p className="truncate font-mono text-xs text-fg-subtle" data-testid="init-path">
          {path}
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function InitRepoDialog() {
  const isOpen = useHomeDialogs((s) => s.init);
  const close = useHomeDialogs((s) => s.close);
  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">{isOpen && <Form onClose={close} />}</DialogContent>
    </Dialog>
  );
}
