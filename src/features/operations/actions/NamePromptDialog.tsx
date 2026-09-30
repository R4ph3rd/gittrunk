import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  Input,
  Label,
} from "@/design/components";
import { useDndStore } from "@/stores/dnd";
import { requestOperation } from "../preview/useConfirmedOperation";
import { ops } from "./ops";
import type { PromptRequest } from "./types";

const copy = {
  branch: { title: "Create branch", confirm: "Create branch" },
  tag: { title: "Create tag", confirm: "Create tag" },
  rename: { title: "Rename branch", confirm: "Rename" },
} as const;

function Form({ request, onClose }: { request: PromptRequest; onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(request.kind === "rename" ? request.oldName : "");
  const [checkout, setCheckout] = useState(true);
  const [message, setMessage] = useState("");
  const trimmed = name.trim();
  const invalid = trimmed === "" || /\s/.test(trimmed);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    const { repoId } = request;
    const spec =
      request.kind === "branch"
        ? ops.branchCreate(repoId, { name: trimmed, startPoint: request.startPoint, checkout })
        : request.kind === "tag"
          ? ops.tagCreate(repoId, {
              name: trimmed,
              target: request.target,
              message: message.trim() || null,
            })
          : ops.branchRename(repoId, request.oldName, trimmed);
    onClose();
    void requestOperation(client, spec);
  };

  const text = copy[request.kind];
  return (
    <form onSubmit={submit}>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{text.title}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {request.kind === "rename" ? `Rename ${request.oldName}.` : `At ${request.label}.`}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ops-name">Name</Label>
          <Input
            id="ops-name"
            autoFocus
            value={name}
            aria-invalid={name !== "" && invalid}
            onChange={(e) => setName(e.target.value)}
            placeholder={request.kind === "tag" ? "v1.0.0" : "feature/name"}
          />
        </div>
        {request.kind === "branch" && (
          <Checkbox
            label="Check out after creating"
            checked={checkout}
            onCheckedChange={setCheckout}
          />
        )}
        {request.kind === "tag" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="ops-message">Message (optional, makes an annotated tag)</Label>
            <Input id="ops-message" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
        )}
      </div>
      <ResponsiveDialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={invalid}>
          {text.confirm}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

/** Asks for a branch or tag name (create here, rename). Mount once (the provider does). */
export function NamePromptHost() {
  const prompt = useDndStore((s) => s.prompt);
  const setPrompt = useDndStore((s) => s.setPrompt);
  return (
    <ResponsiveDialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) setPrompt(null);
      }}
    >
      <ResponsiveDialogContent hideClose>
        {prompt && <Form request={prompt} onClose={() => setPrompt(null)} />}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
