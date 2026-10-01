import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Input, Label, SegmentedControl, Spinner } from "@/design/components";
import type { AvatarMode } from "@/ipc/bindings";
import {
  invalidateAvatars,
  useClearForgeToken,
  useForgeTokenSource,
  useSetForgeToken,
} from "@/ipc/queries";
import { updateSettings, useSettings } from "@/stores/settings";
import { GITHUB_HOST } from "./gate";
import { errorMessage } from "./helpers";

const STATUS: Record<"forge" | "gitCredential" | "none", string> = {
  forge: "Token saved",
  gitCredential: "Using the HTTPS credential saved for github.com",
  none: "No token: public repositories only, read-only",
};

function GithubToken() {
  const source = useForgeTokenSource(GITHUB_HOST);
  const save = useSetForgeToken();
  const clear = useClearForgeToken();
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    setError(null);
    setConnected(null);
    try {
      const user = await save.mutateAsync({ host: GITHUB_HOST, token: value });
      setConnected(user.login);
      setToken(""); // the value is never kept or displayed after saving
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const onRemove = async () => {
    setError(null);
    setConnected(null);
    try {
      await clear.mutateAsync(GITHUB_HOST);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section aria-labelledby="integrations-github" className="border-b border-border py-3">
      <h3 id="integrations-github" className="text-base font-medium text-fg">
        GitHub token
      </h3>
      <p className="mb-2 text-sm text-fg-muted" role="status">
        {source.data ? STATUS[source.data] : "Checking token…"}
      </p>
      <form className="flex gap-2" onSubmit={(e) => void onSave(e)}>
        <Input
          type="password"
          aria-label="Personal access token"
          placeholder="Paste a personal access token"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!token.trim()} loading={save.isPending}>
          Save
        </Button>
        {source.data === "forge" ? (
          <Button loading={clear.isPending} onClick={() => void onRemove()}>
            Remove
          </Button>
        ) : null}
      </form>
      {connected ? (
        <p role="status" className="mt-1 text-sm text-success">
          Connected as @{connected}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-fg-muted">
        Use a classic token with the repo scope (or public_repo for public repositories), or a
        fine-grained token with Issues and Contents read and write access. The token is stored in
        the system keychain and never shown again.
      </p>
    </section>
  );
}

function Avatars() {
  const client = useQueryClient();
  const { avatars } = useSettings();
  const [busy, setBusy] = useState(false);

  const change = async (next: AvatarMode) => {
    if (next === avatars) return;
    setBusy(true);
    const result = await updateSettings({ avatars: next });
    if (result.ok) await invalidateAvatars(client);
    setBusy(false);
  };

  return (
    <section aria-labelledby="integrations-avatars" className="py-3">
      <Label id="integrations-avatars" className="text-base font-medium text-fg">
        Avatars
      </Label>
      <div className="mt-2 flex items-center gap-2">
        <SegmentedControl<AvatarMode>
          aria-label="Avatars"
          value={avatars}
          onValueChange={(v) => void change(v)}
          options={[
            { value: "off", label: "Off" },
            { value: "github", label: "GitHub only" },
            { value: "githubAndGravatar", label: "GitHub and Gravatar" },
          ]}
        />
        {busy ? <Spinner label="Saving" /> : null}
      </div>
      <p className="mt-2 text-sm text-fg-muted">
        Avatars are downloaded by gittrunk, not by the page. Gravatar receives a hash of each commit
        author&apos;s email.
      </p>
    </section>
  );
}

/** Settings > Integrations: GitHub token and avatar source. */
export function Integrations() {
  return (
    <>
      <GithubToken />
      <Avatars />
    </>
  );
}
