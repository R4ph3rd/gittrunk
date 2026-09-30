import { useState } from "react";
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
  const label = isUsername ? "Username" : request.kind === "password" ? "Password" : "Passphrase";

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
      <DialogHeader>
        <DialogTitle>{TITLES[request.kind]}</DialogTitle>
        <DialogDescription className="break-all font-mono text-sm">{request.url}</DialogDescription>
      </DialogHeader>
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
        <DialogFooter>
          <Button type="button" onClick={() => respond(null)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {isUsername ? "Continue" : "Sign in"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** Global dialog answering `credential-requested`; concurrent requests are shown one at a time. */
export function CredentialPrompt() {
  const request = useCredentialQueue((s) => s.queue[0] ?? null);
  const pending = useCredentialQueue((s) => s.queue.length);
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && request) {
          useCredentialQueue.getState().shift(request.requestId);
          void unwrap(commands.credentialRespond(request.requestId, null, false)).catch(() => {});
        }
      }}
    >
      <DialogContent hideClose>
        {request && (
          <>
            <CredentialForm key={request.requestId} request={request} />
            {pending > 1 && (
              <p className="mt-2 text-xs text-fg-subtle">{pending - 1} more waiting</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
