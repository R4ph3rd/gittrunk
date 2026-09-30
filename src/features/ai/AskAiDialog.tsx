import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertDialog,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  toast,
} from "@/design/components";
import { commands, type AiPayloadPreview, type AiPlan, type OpOutcome } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateAfterOp } from "@/ipc/queries";
import { openAiSettings, useAiStore } from "@/stores/ai";
import { errorMessage, isAiDisabled } from "./api";
import { PayloadPreview } from "./PayloadPreview";
import { PlanView } from "./PlanView";

type Phase =
  | { name: "input" }
  | { name: "preview"; preview: AiPayloadPreview }
  | { name: "loading"; label: string }
  | { name: "plan"; plan: AiPlan };

function Form({ repoId, onClose }: { repoId: string; onClose: () => void }) {
  const client = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "input" });
  const [error, setError] = useState<{ message: string; disabled: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const fail = (e: unknown) => {
    setError({ message: errorMessage(e), disabled: isAiDisabled(e) });
    setPhase({ name: "input" });
  };

  const request = { kind: "plan", prompt: prompt.trim() } as const;

  const preview = async () => {
    setError(null);
    setPhase({ name: "loading", label: "Preparing request..." });
    try {
      setPhase({
        name: "preview",
        preview: await unwrap(commands.aiPayloadPreview(repoId, request)),
      });
    } catch (e) {
      fail(e);
    }
  };

  const send = async () => {
    setPhase({ name: "loading", label: "Asking the assistant..." });
    try {
      const response = await unwrap(commands.aiRun(repoId, request));
      if (response.kind !== "plan") throw new Error("Unexpected response from the AI service");
      setPhase({ name: "plan", plan: response.plan });
    } catch (e) {
      fail(e);
    }
  };

  const undo = async () => {
    try {
      await unwrap(commands.undo(repoId, false));
      await invalidateAfterOp(client, repoId);
      toast.success("Undone");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const report = (outcome: OpOutcome) => {
    if (outcome.kind === "applied") {
      toast.success(outcome.message, {
        // Fetch and push are not journaled: nothing to undo.
        action: outcome.oplogId ? { label: "Undo", onClick: () => void undo() } : undefined,
      });
    } else if (outcome.kind === "conflicted") {
      toast.warning(`Plan stopped: conflicts in ${outcome.files.join(", ")}`, {
        action: outcome.oplogId ? { label: "Undo", onClick: () => void undo() } : undefined,
      });
    }
  };

  const run = async (plan: AiPlan) => {
    setConfirming(false);
    setPhase({ name: "loading", label: "Running plan..." });
    try {
      report(await unwrap(commands.aiPlanExecute(repoId, plan.id)));
      await invalidateAfterOp(client, repoId);
      onClose();
    } catch (e) {
      await invalidateAfterOp(client, repoId);
      toast.error(errorMessage(e));
      setPhase({ name: "plan", plan });
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ask AI</DialogTitle>
        <DialogDescription>
          Describe what you want to do. You will see exactly what is sent, then a plan to review
          before anything runs.
        </DialogDescription>
      </DialogHeader>

      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg-subtle p-2 text-base text-danger"
        >
          <span>{error.message}</span>
          {error.disabled ? (
            <Button
              size="sm"
              onClick={() => {
                onClose();
                openAiSettings();
              }}
            >
              Open AI settings
            </Button>
          ) : null}
        </div>
      ) : null}

      {phase.name === "input" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim()) void preview();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-prompt">What do you want to do?</Label>
            <textarea
              id="ai-prompt"
              autoFocus
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. create a branch called fix/login from main and switch to it"
              className="w-full resize-y rounded-md border border-border bg-bg-subtle p-2 text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
            />
          </div>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!prompt.trim()}>
              Preview request
            </Button>
          </DialogFooter>
        </form>
      ) : null}

      {phase.name === "preview" ? (
        <>
          <PayloadPreview preview={phase.preview} />
          <DialogFooter>
            <Button onClick={() => setPhase({ name: "input" })}>Back</Button>
            <Button variant="primary" onClick={() => void send()}>
              Send
            </Button>
          </DialogFooter>
        </>
      ) : null}

      {phase.name === "loading" ? (
        <p role="status" className="text-base text-fg-muted">
          {phase.label}
        </p>
      ) : null}

      {phase.name === "plan" ? (
        <>
          <PlanView plan={phase.plan} />
          <DialogFooter>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={phase.plan.steps.length === 0}
              onClick={() => setConfirming(true)}
            >
              Run plan
            </Button>
          </DialogFooter>
          <AlertDialog
            open={confirming}
            onOpenChange={setConfirming}
            destructive={false}
            title="Run this plan?"
            description={`${phase.plan.steps.length} step${phase.plan.steps.length === 1 ? "" : "s"} will run in order and stop at the first error or conflict. Each step can be undone from the operation log.`}
            confirmLabel="Run plan"
            onConfirm={() => void run(phase.plan)}
          />
        </>
      ) : null}
    </>
  );
}

/** "Ask AI..." dialog: prompt, payload preview, plan review, confirmed execution. */
export function AskAiDialog() {
  const repoId = useAiStore((s) => s.askRepoId);
  const close = useAiStore((s) => s.closeAsk);
  return (
    <Dialog open={repoId !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-xl">
        {repoId ? <Form repoId={repoId} onClose={close} /> : null}
      </DialogContent>
    </Dialog>
  );
}
