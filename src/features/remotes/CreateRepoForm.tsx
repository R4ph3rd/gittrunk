import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Input,
  Label,
  ResponsiveDialogFooter,
  SegmentedControl,
  toast,
} from "@/design/components";
import { useOpenIntegrations } from "@/features/forge/helpers";
import { usePlatform } from "@/app/platform";
import { commands } from "@/ipc/bindings";
import { isIpcError, unwrap } from "@/ipc/client";
import {
  invalidateAfterOp,
  useForgeOwners,
  useForgeTokenSource,
  useRefs,
  useRemotes,
} from "@/ipc/queries";
import { useActiveRepo } from "@/stores/repo";
import { NativeSelect } from "./NativeSelect";
import { headBranch, pushTo } from "./actions";
import { suggestRepoName, validateRemoteName, validateRepoName } from "./validate";

const HOST = "github.com";

export interface CreatePrefill {
  owner?: string;
  name?: string;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "Create a new repository on GitHub", then add it as a remote and optionally push. */
export function CreateRepoForm({
  repoId,
  prefill,
  onDone,
}: {
  repoId: string;
  prefill?: CreatePrefill;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const active = useActiveRepo();
  const platform = usePlatform();
  const openIntegrations = useOpenIntegrations();
  const tokenSource = useForgeTokenSource(HOST);
  const hasToken = tokenSource.data !== undefined && tokenSource.data !== "none";
  const owners = useForgeOwners(HOST, hasToken);
  const remotes = useRemotes(repoId);
  const refs = useRefs(repoId);
  const branch = headBranch(refs.data)?.name ?? null;

  const defaultRemote = remotes.data?.some((r) => r.name === "origin") ? "github" : "origin";
  const [ownerChoice, setOwnerChoice] = useState<string | null>(prefill?.owner ?? null);
  const [name, setName] = useState(prefill?.name ?? suggestRepoName(active?.name ?? ""));
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [remoteChoice, setRemoteChoice] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<"https" | "ssh">("https");
  const [push, setPush] = useState(true);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);

  const ownerList = owners.data ?? [];
  const owner = ownerChoice ?? ownerList[0]?.login ?? "";
  const remoteName = remoteChoice ?? defaultRemote;
  const nameError = validateRepoName(name);
  const remoteError = validateRemoteName(remoteName);
  const takenRemote = remotes.data?.some((r) => r.name === remoteName) ?? false;
  const canPush = branch !== null;

  const urls = useMemo(
    () => ({
      https: `https://${HOST}/${owner}/${name}.git`,
      ssh: `git@${HOST}:${owner}/${name}.git`,
    }),
    [owner, name],
  );

  const run = useMutation({
    mutationFn: async (create: boolean) => {
      let url = protocol === "ssh" ? urls.ssh : urls.https;
      if (create) {
        const made = await unwrap(
          commands.forgeCreateRepo(HOST, {
            owner,
            name,
            description: description.trim() || null,
            private: visibility === "private",
          }),
        );
        url = protocol === "ssh" ? made.sshUrl : made.cloneUrl;
      }
      await unwrap(commands.remoteAdd(repoId, { name: remoteName, url, fetch: false }));
      return create;
    },
    onSuccess: (created) => {
      void invalidateAfterOp(client, repoId);
      toast.success(
        created ? `Created ${owner}/${name} and added ${remoteName}` : `Remote ${remoteName} added`,
      );
      if (push && branch) {
        void pushTo(repoId, {
          remote: remoteName,
          branch,
          remoteBranch: branch,
          setUpstream: true,
          forceWithLease: false,
        });
      }
      onDone();
    },
    onError: (e) => {
      const already = isIpcError(e) && e.error.detail === "already_exists";
      setExists(already);
      setError(errorText(e));
    },
  });

  const submit = (create: boolean) => {
    setTouched(true);
    setError(null);
    setExists(false);
    if (nameError || remoteError || takenRemote || !owner) return;
    run.mutate(create);
  };

  if (tokenSource.isSuccess && !hasToken) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="text-base text-fg-muted">
          Creating a repository needs a GitHub token. Add one in Settings &gt; Integrations with the{" "}
          <code>repo</code> scope, or a fine-grained token with &quot;Administration: write&quot;.
        </p>
        <ResponsiveDialogFooter>
          <Button type="button" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onDone();
              openIntegrations();
            }}
          >
            Open Settings &gt; Integrations
          </Button>
        </ResponsiveDialogFooter>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="create-owner">Owner</Label>
        <NativeSelect
          id="create-owner"
          value={owner}
          disabled={owners.isPending}
          onChange={(e) => setOwnerChoice(e.target.value)}
        >
          {owner && !ownerList.some((o) => o.login === owner) && (
            <option value={owner}>{owner}</option>
          )}
          {ownerList.map((o) => (
            <option key={o.login} value={o.login}>
              {o.kind === "org" ? `${o.login} (organization)` : o.login}
            </option>
          ))}
        </NativeSelect>
        {owners.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorText(owners.error)}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="create-name">Repository name</Label>
        <Input
          id="create-name"
          value={name}
          autoFocus
          aria-invalid={touched && nameError ? "true" : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {touched && nameError && (
          <p role="alert" className="text-sm text-danger">
            {nameError}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="create-description">Description (optional)</Label>
        <Input
          id="create-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="Visibility"
          value={visibility}
          onValueChange={setVisibility}
          options={[
            { value: "private", label: "Private" },
            { value: "public", label: "Public" },
          ]}
        />
        <SegmentedControl
          aria-label="Protocol"
          value={platform.supportsSsh ? protocol : "https"}
          onValueChange={setProtocol}
          options={[
            { value: "https", label: "HTTPS" },
            { value: "ssh", label: "SSH", disabled: !platform.supportsSsh },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="create-remote">Remote name</Label>
        <Input
          id="create-remote"
          value={remoteName}
          aria-invalid={touched && (remoteError || takenRemote) ? "true" : undefined}
          onChange={(e) => setRemoteChoice(e.target.value)}
        />
        {touched && (remoteError || takenRemote) && (
          <p role="alert" className="text-sm text-danger">
            {remoteError ?? `A remote named ${remoteName} already exists`}
          </p>
        )}
      </div>
      <Checkbox
        label={
          branch
            ? `Push ${branch} and set upstream`
            : "Push current branch and set upstream (no branch checked out)"
        }
        checked={push && canPush}
        disabled={!canPush}
        onCheckedChange={setPush}
      />
      {error && (
        <div role="alert" className="flex flex-col gap-2 text-sm text-danger">
          <p>{error}</p>
          {exists && (
            <div>
              <Button type="button" size="sm" onClick={() => submit(false)}>
                Add the existing repository as a remote
              </Button>
            </div>
          )}
        </div>
      )}
      <ResponsiveDialogFooter>
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={run.isPending}>
          Create repository
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
