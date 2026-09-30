import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
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
  Checkbox,
} from "@/design/components";
import { runOp } from "@/features/ops/ops";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { queryKeys } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { useRemotesUi } from "@/stores/remotes";
import { joinPath, repoNameFromUrl, validateRemoteUrl } from "./validate";

function Form({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [destEdit, setDestEdit] = useState<string | null>(null);
  const [bare, setBare] = useState(false);
  const [recurse, setRecurse] = useState(false);
  const [touched, setTouched] = useState(false);

  const dest = destEdit ?? joinPath(parent, repoNameFromUrl(url));
  const urlError = validateRemoteUrl(url);
  const destError = dest.trim() ? null : "Choose a destination folder";

  const browse = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") {
      setParent(picked);
      setDestEdit(null);
    }
  };

  const submit = () => {
    setTouched(true);
    if (urlError || destError) return;
    const target = dest.trim();
    const source = url.trim();
    void runOp({
      kind: "clone",
      repoId: null,
      label: `Cloning ${repoNameFromUrl(source) || source}`,
      doneLabel: "Clone complete",
      start: () =>
        unwrap(commands.repoClone({ url: source, dest: target, bare, recurseSubmodules: recurse })),
      onSuccess: async () => {
        try {
          useRepoStore.getState().addRepo(await unwrap(commands.repoOpen(target)));
          void client.invalidateQueries({ queryKey: queryKeys.recent });
        } catch (err) {
          toast.error(`Cloned, but could not open: ${err instanceof Error ? err.message : err}`);
        }
      },
    });
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Clone repository</DialogTitle>
        <DialogDescription>Copy a remote repository to your machine.</DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="clone-url">Repository URL</Label>
          <Input
            id="clone-url"
            value={url}
            autoFocus
            placeholder="https://github.com/acme/demo.git"
            aria-invalid={touched && urlError ? "true" : undefined}
            onChange={(e) => setUrl(e.target.value)}
          />
          {touched && urlError && (
            <p role="alert" className="text-sm text-danger">
              {urlError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="clone-dest">Destination</Label>
          <div className="flex gap-2">
            <Input
              id="clone-dest"
              value={dest}
              placeholder="Choose a folder"
              aria-invalid={touched && destError ? "true" : undefined}
              onChange={(e) => setDestEdit(e.target.value)}
            />
            <Button type="button" onClick={() => void browse()}>
              <FolderOpen />
              Browse
            </Button>
          </div>
          {touched && destError && (
            <p role="alert" className="text-sm text-danger">
              {destError}
            </p>
          )}
        </div>
        <Checkbox label="Bare repository" checked={bare} onCheckedChange={setBare} />
        <Checkbox label="Recurse submodules" checked={recurse} onCheckedChange={setRecurse} />
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Clone
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function CloneDialog() {
  const openState = useRemotesUi((s) => s.cloneOpen);
  const setOpen = useRemotesUi((s) => s.setCloneOpen);
  return (
    <Dialog open={openState} onOpenChange={setOpen}>
      <DialogContent>{openState && <Form onClose={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}
