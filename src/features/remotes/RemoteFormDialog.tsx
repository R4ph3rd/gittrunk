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
  Input,
  Label,
  toast,
  Checkbox,
  SegmentedControl,
} from "@/design/components";
import { usePlatform } from "@/app/platform";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateAfterOp, useForgeRepoExists, useForgeTokenSource } from "@/ipc/queries";
import { CreateRepoForm, type CreatePrefill } from "./CreateRepoForm";
import { fetchRemote } from "./actions";
import { parseRepoUrl, validateRemoteName, validateRemoteUrl } from "./validate";

export type RemoteFormMode =
  { kind: "add" } | { kind: "rename"; name: string } | { kind: "url"; name: string; url: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Form({
  repoId,
  mode,
  onDone,
}: {
  repoId: string;
  mode: RemoteFormMode;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(mode.kind === "rename" ? mode.name : "");
  const [url, setUrl] = useState(mode.kind === "url" ? mode.url : "");
  const [fetchAfter, setFetchAfter] = useState(true);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [source, setSource] = useState<"existing" | "create">("existing");
  const [prefill, setPrefill] = useState<CreatePrefill | undefined>(undefined);
  const platform = usePlatform();
  const canCreate = mode.kind === "add" && !platform.readOnly;
  const parsed = mode.kind === "add" ? parseRepoUrl(url) : null;
  const onGithub = parsed?.host === "github.com";
  const tokenSource = useForgeTokenSource("github.com");
  const hasToken = tokenSource.data !== undefined && tokenSource.data !== "none";
  const existence = useForgeRepoExists(
    "github.com",
    onGithub ? { owner: parsed.owner, name: parsed.name } : null,
    canCreate && hasToken,
  );
  const missing = onGithub && existence.data === false;

  const needsName = mode.kind !== "url";
  const needsUrl = mode.kind !== "rename";
  const nameError = needsName ? validateRemoteName(name) : null;
  const urlError = needsUrl ? validateRemoteUrl(url) : null;

  const save = useMutation({
    mutationFn: async () => {
      if (mode.kind === "add") {
        // The fetch runs as a normal op afterwards so its errors are visible while the add itself
        // never fails because the remote repository is missing or unreachable.
        await unwrap(commands.remoteAdd(repoId, { name, url: url.trim(), fetch: false }));
        if (fetchAfter && !missing) void fetchRemote(repoId, name);
      } else if (mode.kind === "rename") {
        await unwrap(commands.remoteRename(repoId, mode.name, name));
      } else {
        await unwrap(commands.remoteSetUrl(repoId, mode.name, url.trim(), false));
      }
    },
    onSuccess: () => {
      void invalidateAfterOp(client, repoId);
      toast.success(
        mode.kind === "add"
          ? `Remote ${name} added`
          : mode.kind === "rename"
            ? `Renamed to ${name}`
            : "Remote URL updated",
      );
      onDone();
    },
    onError: (e) => setServerError(errorText(e)),
  });

  const submit = () => {
    setTouched(true);
    setServerError(null);
    if (nameError || urlError) return;
    save.mutate();
  };

  const title =
    mode.kind === "add"
      ? "Add remote"
      : mode.kind === "rename"
        ? `Rename ${mode.name}`
        : "Edit URL";

  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {mode.kind === "url" ? `URL of the remote ${mode.name}.` : "Name and URL of the remote."}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      {canCreate && (
        <SegmentedControl
          aria-label="Remote source"
          value={source}
          onValueChange={setSource}
          options={[
            { value: "existing", label: "Existing URL" },
            { value: "create", label: "Create new on GitHub" },
          ]}
        />
      )}
      {source === "create" && canCreate ? (
        <CreateRepoForm repoId={repoId} prefill={prefill} onDone={onDone} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3"
        >
          {needsName && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="remote-name">Name</Label>
              <Input
                id="remote-name"
                value={name}
                autoFocus
                placeholder="origin"
                aria-invalid={touched && nameError ? "true" : undefined}
                aria-describedby={touched && nameError ? "remote-name-error" : undefined}
                onChange={(e) => setName(e.target.value)}
              />
              {touched && nameError && (
                <p id="remote-name-error" role="alert" className="text-sm text-danger">
                  {nameError}
                </p>
              )}
            </div>
          )}
          {needsUrl && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="remote-url">URL</Label>
              <Input
                id="remote-url"
                value={url}
                autoFocus={!needsName}
                placeholder="https://github.com/acme/demo.git"
                aria-invalid={touched && urlError ? "true" : undefined}
                aria-describedby={touched && urlError ? "remote-url-error" : undefined}
                onChange={(e) => setUrl(e.target.value)}
              />
              {touched && urlError && (
                <p id="remote-url-error" role="alert" className="text-sm text-danger">
                  {urlError}
                </p>
              )}
              {missing && parsed && (
                <div
                  role="status"
                  className="flex flex-col items-start gap-2 text-sm text-fg-muted"
                >
                  <p>This repository doesn&apos;t exist on GitHub. Create it?</p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setPrefill({ owner: parsed.owner, name: parsed.name });
                      setSource("create");
                    }}
                  >
                    Create {parsed.owner}/{parsed.name}
                  </Button>
                </div>
              )}
              {canCreate && onGithub && !hasToken && tokenSource.isSuccess && (
                <p className="text-sm text-fg-muted">
                  Add a GitHub token in Settings &gt; Integrations to create this repository if it
                  doesn&apos;t exist yet.
                </p>
              )}
              {canCreate && parsed && !onGithub && (
                <p className="text-sm text-fg-muted">
                  The remote is added as is. Automatic repository creation is GitHub-only for now;
                  create the repository on {parsed.host} first.
                </p>
              )}
            </div>
          )}
          {mode.kind === "add" && (
            <Checkbox
              label="Fetch after adding"
              checked={fetchAfter}
              onCheckedChange={setFetchAfter}
            />
          )}
          {serverError && (
            <p role="alert" className="text-sm text-danger">
              {serverError}
            </p>
          )}
          <ResponsiveDialogFooter>
            <Button type="button" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {mode.kind === "add" ? "Add remote" : "Save"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      )}
    </>
  );
}

/** Add-remote, rename and edit-URL forms share one dialog. `mode = null` closes it. */
export function RemoteFormDialog({
  repoId,
  mode,
  onClose,
}: {
  repoId: string;
  mode: RemoteFormMode | null;
  onClose: () => void;
}) {
  return (
    <ResponsiveDialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        {mode && <Form repoId={repoId} mode={mode} onDone={onClose} />}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
