import { useRef, useState, type FormEvent } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Badge, Button, Input, Label, Spinner, toast } from "@/design/components";
import { errorMessage } from "@/features/forge/helpers";
import type { SshKey } from "@/ipc/bindings";
import { openUrl, useGenerateSshKey, useGitIdentity, useSshKeys } from "@/ipc/queries";

const GITHUB_SSH_URL = "https://github.com/settings/ssh/new";
const GITLAB_SSH_URL = "https://gitlab.com/-/user_settings/ssh_keys";
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function validateName(name: string, existing: string[]): string | null {
  if (!NAME_PATTERN.test(name)) {
    return "Use letters, digits, dot, dash or underscore (up to 64 characters, starting with a letter or digit).";
  }
  if (name.endsWith(".pub")) return "The name cannot end in .pub.";
  if (existing.includes(name)) return `A key named ${name} already exists.`;
  return null;
}

function reportOpen(url: string) {
  openUrl(url).catch((e: unknown) => toast.error(errorMessage(e)));
}

function KeyCard({ sshKey }: { sshKey: SshKey }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sshKey.publicKey);
      toast.success("Public key copied");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <li
      id={`ssh-key-${sshKey.name}`}
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium text-fg">{sshKey.name}</span>
        <Badge>{sshKey.algorithm}</Badge>
        {sshKey.hasPrivateKey ? null : <Badge variant="warning">Public key only</Badge>}
      </div>
      <p className="select-text break-all font-mono text-sm text-fg-muted">{sshKey.fingerprint}</p>
      {sshKey.comment ? <p className="text-sm text-fg-muted">{sshKey.comment}</p> : null}
      <input
        readOnly
        aria-label={`Public key of ${sshKey.name}`}
        value={sshKey.publicKey}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        className="h-[var(--control-md)] w-full truncate rounded-md border border-border bg-bg-subtle px-2 font-mono text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void copy()}>
          <Copy />
          Copy public key
        </Button>
        <Button size="sm" onClick={() => reportOpen(GITHUB_SSH_URL)}>
          <ExternalLink />
          Add to GitHub
        </Button>
        <Button size="sm" onClick={() => reportOpen(GITLAB_SSH_URL)}>
          <ExternalLink />
          Add to GitLab
        </Button>
      </div>
    </li>
  );
}

function GenerateForm({
  existing,
  onCreated,
}: {
  existing: string[];
  onCreated(name: string): unknown;
}) {
  const identity = useGitIdentity();
  const generate = useGenerateSshKey();
  const defaultName = existing.includes("id_ed25519") ? "id_ed25519_gittrunk" : "id_ed25519";
  const [name, setName] = useState<string | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nameValue = name ?? defaultName;
  const commentValue = comment ?? identity.data?.email ?? "";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const nameError = validateName(nameValue, existing);
    if (nameError) return setError(nameError);
    if (passphrase !== confirm) return setError("The passphrases do not match.");
    setError(null);
    try {
      const created = await generate.mutateAsync({
        name: nameValue,
        comment: commentValue,
        passphrase: passphrase || null,
      });
      setPassphrase("");
      setConfirm("");
      setName(null);
      toast.success(`Created ${created.name}`);
      onCreated(created.name);
    } catch (err) {
      // Never echo the passphrase: only the backend's message is shown.
      setPassphrase("");
      setConfirm("");
      setError(errorMessage(err));
    }
  };

  return (
    <form
      aria-label="Generate SSH key"
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      onSubmit={(e) => void onSubmit(e)}
    >
      <h3 className="text-base font-medium text-fg">Generate a new key</h3>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ssh-name">Name</Label>
        <Input
          id="ssh-name"
          value={nameValue}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ssh-comment">Comment</Label>
        <Input
          id="ssh-comment"
          value={commentValue}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ssh-passphrase">Passphrase</Label>
          <Input
            id="ssh-passphrase"
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ssh-passphrase-confirm">Confirm passphrase</Label>
          <Input
            id="ssh-passphrase-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </div>
      <p className="text-sm text-fg-muted">
        Ed25519 key. Leave the passphrase empty for no passphrase.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" loading={generate.isPending}>
          Generate key
        </Button>
      </div>
    </form>
  );
}

/** Settings > SSH keys: the keys in ~/.ssh and an ed25519 generator. Desktop only. */
export function SshKeysSection() {
  const keys = useSshKeys();
  const listRef = useRef<HTMLUListElement>(null);
  const existing = keys.data?.keys.map((k) => k.name) ?? [];

  // The list is already refreshed when generation resolves: focus the new key after the render.
  const focusKey = (name: string) =>
    setTimeout(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[id="ssh-key-${name}"]`);
      el?.scrollIntoView?.({ block: "nearest" });
      el?.focus();
    }, 0);

  if (keys.isPending) return <Spinner label="Loading SSH keys" className="my-4" />;
  if (keys.isError) {
    return (
      <div className="flex flex-col items-start gap-2 py-3">
        <p role="alert" className="text-base text-danger">
          {errorMessage(keys.error)}
        </p>
        <Button onClick={() => void keys.refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-3">
      <p className="text-sm text-fg-muted">
        Keys in <span className="font-mono text-fg">{keys.data.dir}</span>
      </p>
      {keys.data.keys.length === 0 ? (
        <p className="text-base text-fg-muted">No SSH keys yet</p>
      ) : (
        <ul ref={listRef} aria-label="SSH keys" className="flex flex-col gap-3">
          {keys.data.keys.map((k) => (
            <KeyCard key={k.name} sshKey={k} />
          ))}
        </ul>
      )}
      <GenerateForm existing={existing} onCreated={focusKey} />
    </div>
  );
}
