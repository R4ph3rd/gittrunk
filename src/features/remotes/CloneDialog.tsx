import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { ClipboardPaste, FolderOpen } from "lucide-react";
import { usePlatform } from "@/app/platform";
import {
  Button,
  Checkbox,
  Input,
  Label,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  toast,
} from "@/design/components";
import { runOp } from "@/features/ops/ops";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { queryKeys } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { useRemotesUi } from "@/stores/remotes";
import { hostOfUrl, joinPath, repoNameFromUrl, validateRemoteUrl } from "./validate";

function Form({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const platform = usePlatform();
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [destEdit, setDestEdit] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [bare, setBare] = useState(false);
  const [recurse, setRecurse] = useState(false);
  const [touched, setTouched] = useState(false);
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");

  // Without SSH only https URLs work, authenticated with a personal access token.
  const httpsOnly = !platform.supportsSsh;
  // With an app storage directory the destination is `<defaultReposDir>/<name>` unless a folder
  // was picked explicitly.
  const reposDir = platform.defaultReposDir;
  const appStorage = reposDir !== null && parent === "";
  const name = nameEdit ?? repoNameFromUrl(url);
  const dest = appStorage
    ? joinPath(reposDir, name)
    : (destEdit ?? joinPath(parent, repoNameFromUrl(url)));
  const urlError = validateRemoteUrl(url, { httpsOnly });
  const destError = dest.trim() ? null : "Choose a destination folder";
  const canPaste = typeof navigator !== "undefined" && !!navigator.clipboard?.readText;

  const browse = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") {
      setParent(picked);
      setDestEdit(null);
    }
  };

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setUrl(text);
    } catch {
      toast.error("Could not read the clipboard");
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
      start: async () => {
        // Store the token first so the clone's credential callback finds it.
        const host = hostOfUrl(source);
        if (token.trim() && host) {
          await unwrap(
            commands.credentialStore({ host, username: username.trim(), secret: token.trim() }),
          );
        }
        return unwrap(
          commands.repoClone({ url: source, dest: target, bare, recurseSubmodules: recurse }),
        );
      },
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
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>Clone repository</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {httpsOnly
            ? "Copy a remote repository into app storage over HTTPS."
            : "Copy a remote repository to your machine."}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
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
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="https://github.com/acme/demo.git"
            aria-invalid={touched && urlError ? "true" : undefined}
            onChange={(e) => setUrl(e.target.value)}
          />
          {canPaste && url === "" && (
            <Button type="button" size="sm" className="self-start" onClick={() => void paste()}>
              <ClipboardPaste />
              Paste from clipboard
            </Button>
          )}
          {touched && urlError && (
            <p role="alert" className="text-sm text-danger">
              {urlError}
            </p>
          )}
        </div>
        {appStorage ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="clone-name">Folder name</Label>
            <Input
              id="clone-name"
              value={name}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setNameEdit(e.target.value)}
            />
            <p className="truncate font-mono text-xs text-fg-subtle" data-testid="clone-dest">
              {dest}
            </p>
            {platform.canPickFolder && (
              <Button type="button" className="self-start" onClick={() => void browse()}>
                <FolderOpen />
                Choose another folder
              </Button>
            )}
            {touched && destError && (
              <p role="alert" className="text-sm text-danger">
                {destError}
              </p>
            )}
          </div>
        ) : (
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
              {platform.canPickFolder && (
                <Button type="button" onClick={() => void browse()}>
                  <FolderOpen />
                  Browse
                </Button>
              )}
            </div>
            {touched && destError && (
              <p role="alert" className="text-sm text-danger">
                {destError}
              </p>
            )}
          </div>
        )}
        {httpsOnly && (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="clone-username">Username (optional)</Label>
              <Input
                id="clone-username"
                value={username}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="clone-token">Personal access token (optional)</Label>
              <Input
                id="clone-token"
                type="password"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
          </>
        )}
        <Checkbox label="Bare repository" checked={bare} onCheckedChange={setBare} />
        <Checkbox label="Recurse submodules" checked={recurse} onCheckedChange={setRecurse} />
        <ResponsiveDialogFooter>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Clone
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </>
  );
}

export function CloneDialog() {
  const openState = useRemotesUi((s) => s.cloneOpen);
  const setOpen = useRemotesUi((s) => s.setCloneOpen);
  return (
    <ResponsiveDialog open={openState} onOpenChange={setOpen}>
      <ResponsiveDialogContent>
        {openState && <Form onClose={() => setOpen(false)} />}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
