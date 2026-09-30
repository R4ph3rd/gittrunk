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
} from "@/design/components";
import { useAiStore } from "@/stores/ai";
import { usePreviewedRun } from "./usePreviewedRun";

function Form({
  repoId,
  initialBase,
  initialHead,
  onClose,
}: {
  repoId: string;
  initialBase: string;
  initialHead: string;
  onClose: () => void;
}) {
  const [base, setBase] = useState(initialBase);
  const [head, setHead] = useState(initialHead);
  const [text, setText] = useState("");
  const { start, busy, dialog } = usePreviewedRun(repoId);

  const generate = async () => {
    const result = await start({ kind: "prDescription", base: base.trim(), head: head.trim() });
    if (result) setText(result);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Draft pull request description</DialogTitle>
        <DialogDescription>
          Summarizes the commits and changes in base..head. Edit the draft before using it.
        </DialogDescription>
      </DialogHeader>
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="pr-base">Base</Label>
          <Input id="pr-base" value={base} onChange={(e) => setBase(e.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="pr-head">Head</Label>
          <Input id="pr-head" value={head} onChange={(e) => setHead(e.target.value)} />
        </div>
      </div>
      {text ? (
        <textarea
          aria-label="Pull request description"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          className="w-full resize-y rounded-md border border-border bg-bg-subtle p-2 font-mono text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
        />
      ) : null}
      <DialogFooter>
        <Button onClick={onClose}>Close</Button>
        {text ? <Button onClick={() => void copy()}>Copy</Button> : null}
        <Button
          variant="primary"
          loading={busy}
          disabled={!base.trim() || !head.trim()}
          onClick={() => void generate()}
        >
          {text ? "Regenerate" : "Generate"}
        </Button>
      </DialogFooter>
      {dialog}
    </>
  );
}

/** Controlled dialog that drafts a PR description for `base..head`. */
export function AiPrDescriptionDialog({
  repoId,
  base,
  head,
  open,
  onOpenChange,
}: {
  repoId: string;
  base: string;
  head: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <Form
          repoId={repoId}
          initialBase={base}
          initialHead={head}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Store-driven instance used by `AiHost` (`openPrDescription({ repoId, base, head })`). */
export function AiPrDescriptionHost() {
  const target = useAiStore((s) => s.prTarget);
  const close = useAiStore((s) => s.closePrDescription);
  if (!target) return null;
  return (
    <AiPrDescriptionDialog
      repoId={target.repoId}
      base={target.base}
      head={target.head}
      open
      onOpenChange={(open) => !open && close()}
    />
  );
}
