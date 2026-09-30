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
  toast,
  Checkbox,
} from "@/design/components";
import { usePlatform } from "@/app/platform";
import { commands, type CredentialRequested } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { useCredentialQueue } from "./credentials";

const TITLES = {
  username: "Username required",
  password: "Password required",
  passphrase: "Passphrase required",
} as const;

function CredentialForm({ request }: { request: CredentialRequested }) {
  const isUsername = request.kind === "username";
  const [value, setValue] = useState(isUsername ? (request.username ?? "") : "");
  const [remember, setRemember] = useState(false);
  const { supportsSsh } = usePlatform();
  // Without SSH the only secret is an HTTPS personal access token.
  const tokenOnly = !supportsSsh && request.kind === "password";
  const label = isUsername
    ? "Username"
    : tokenOnly
      ? "Personal access token"
      : request.kind === "password"
        ? "Password"
        : "Passphrase";

  const respond = (secret: string | null) => {
    // Remove first so a second click or a close event cannot answer twice.
    useCredentialQueue.getState().shift(request.requestId);
    commands
      .credentialRespond(request.requestId, secret, secret !== null && remember)
      .then((r) => {
        if (r.status === "error") toast.error(`Could not send credential: ${r.error.message}`);
      })
      .catch(() => toast.error("Could not send credential"));
  };

  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{TITLES[request.kind]}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="break-all font-mono text-sm">
          {request.url}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          respond(value);
        }}
        className="flex flex-col gap-3"
      >
        {!isUsername && request.username && (
          <p className="text-sm text-fg-muted">
            Signing in as <span className="text-fg">{request.username}</span>
          </p>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="credential-value">{label}</Label>
          <Input
            id="credential-value"
            type={isUsername ? "text" : "password"}
            autoComplete={isUsername ? "username" : "current-password"}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Checkbox
          label="Remember in system keychain"
          checked={remember}
          onCheckedChange={setRemember}
        />
        <ResponsiveDialogFooter>
          <Button type="button" onClick={() => respond(null)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {isUsername ? "Continue" : "Sign in"}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </>
  );
}

/** Global dialog answering `credential-requested`; concurrent requests are shown one at a time. */
export function CredentialPrompt() {
  const request = useCredentialQueue((s) => s.queue[0] ?? null);
  const pending = useCredentialQueue((s) => s.queue.length);
  return (
    <ResponsiveDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && request) {
          useCredentialQueue.getState().shift(request.requestId);
          void unwrap(commands.credentialRespond(request.requestId, null, false)).catch(() => {});
        }
      }}
    >
      <ResponsiveDialogContent hideClose>
        {request && (
          <>
            <CredentialForm key={request.requestId} request={request} />
            {pending > 1 && (
              <p className="mt-2 text-xs text-fg-subtle">{pending - 1} more waiting</p>
            )}
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
