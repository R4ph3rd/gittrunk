import { useState, type FormEvent } from "react";
import { Button, Input, Label, toast } from "@/design/components";
import { useGitIdentity, useSetGitIdentity } from "@/ipc/queries";

/** Global git identity (`user.name` / `user.email`); shown where there is no git CLI config. */
export function GitIdentityForm() {
  const identity = useGitIdentity();
  const save = useSetGitIdentity();
  const savedName = identity.data?.name ?? "";
  const savedEmail = identity.data?.email ?? "";
  const [name, setName] = useState(savedName);
  const [email, setEmail] = useState(savedEmail);

  // Re-sync drafts when the saved identity changes (initial load, external update).
  const [seen, setSeen] = useState({ name: savedName, email: savedEmail });
  if (seen.name !== savedName || seen.email !== savedEmail) {
    setSeen({ name: savedName, email: savedEmail });
    setName(savedName);
    setEmail(savedEmail);
  }

  const dirty = name.trim() !== savedName || email.trim() !== savedEmail;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { name: name.trim(), email: email.trim() },
      {
        onSuccess: () => toast.success("Git identity saved"),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  return (
    <form
      aria-label="Git identity"
      onSubmit={onSubmit}
      className="flex flex-col gap-2 border-b border-border py-3"
    >
      <h3 className="text-base font-medium text-fg">Git identity</h3>
      <p className="text-sm text-fg-muted">Used as author and committer for new commits.</p>
      <Label htmlFor="settings-identity-name" className="text-base text-fg">
        Name
      </Label>
      <Input
        id="settings-identity-name"
        value={name}
        autoComplete="name"
        autoCapitalize="words"
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
      />
      <Label htmlFor="settings-identity-email" className="text-base text-fg">
        Email
      </Label>
      <Input
        id="settings-identity-email"
        type="email"
        value={email}
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={!dirty} loading={save.isPending}>
        Save identity
      </Button>
    </form>
  );
}
