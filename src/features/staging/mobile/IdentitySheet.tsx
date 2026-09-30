import { useState } from "react";
import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  toast,
} from "@/design/components";
import { useGitIdentity, useSetGitIdentity } from "@/ipc/queries";
import { errorMessage } from "../ops";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the identity was saved; the caller continues the commit. */
  onSaved: () => void;
}

/** Asks for `user.name` and `user.email` before the first commit on a device without git CLI. */
export function IdentitySheet({ open, onOpenChange, onSaved }: Props) {
  const current = useGitIdentity().data;
  const save = useSetGitIdentity();
  const [name, setName] = useState(current?.name ?? "");
  const [email, setEmail] = useState(current?.email ?? "");
  const valid = name.trim().length > 0 && /.+@.+/.test(email.trim());

  const submit = () => {
    if (!valid) return;
    save.mutateAsync({ name: name.trim(), email: email.trim() }).then(
      () => {
        onOpenChange(false);
        onSaved();
      },
      (e: unknown) => toast.error(`Could not save identity: ${errorMessage(e)}`),
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetHeader>
            <SheetTitle>Who are you?</SheetTitle>
            <SheetDescription>
              Every commit records a name and an email. They are stored in your global config on
              this device.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4 pb-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="identity-name">Name</Label>
              <Input
                id="identity-name"
                value={name}
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="next"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="identity-email">Email</Label>
              <Input
                id="identity-email"
                type="email"
                value={email}
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <SheetFooter>
            <Button type="submit" variant="primary" disabled={!valid} loading={save.isPending}>
              Save and commit
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
