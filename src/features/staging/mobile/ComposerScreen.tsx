import { useEffect, useRef } from "react";
import { ChevronRight, X } from "lucide-react";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import type { RouteScreenProps } from "@/app/layout/registry";
import { Button, IconButton, Input, Label, Switch, Textarea } from "@/design/components";
import { useKeyboardInset } from "@/design/hooks";
import { AiCommitMessageButton } from "@/features/ai";
import { useAiEnabled, useCommitDetails, useRepoInfo, useStatus } from "@/ipc/queries";
import { cn } from "@/lib/cn";
import { useComposerStore, useDraft } from "@/stores/composer";
import { useNav } from "@/stores/nav";
import { SUMMARY_SOFT_LIMIT } from "../message";
import { canCommit, useCommit } from "./useCommit";

/** Full-screen commit composer. The draft lives in `useComposerStore`, so leaving keeps it. */
export function ComposerScreen({ repoId }: RouteScreenProps<"compose">) {
  const nav = useNav();
  const draft = useDraft(repoId);
  const update = useComposerStore((s) => s.update);
  const setAmend = useComposerStore((s) => s.setAmend);
  const info = useRepoInfo(repoId);
  const status = useStatus(repoId);
  const aiEnabled = useAiEnabled();
  const inset = useKeyboardInset();
  const { submit, pending, error, sheet } = useCommit(repoId, { onDone: () => nav.pop() });

  const head = info.data?.head;
  const headOid = head && head.kind !== "unborn" ? head.oid : null;
  const stagedCount = status.data?.staged.length ?? 0;
  const headDetails = useCommitDetails(repoId, draft.amend ? headOid : null);

  // Amend pre-fills the message of HEAD once per amend session (never over edits).
  const details = headDetails.data;
  useEffect(() => {
    if (draft.amend && details && draft.amendOid !== details.oid) {
      update(repoId, {
        summary: details.summary,
        body: details.body.trim(),
        amendOid: details.oid,
      });
    }
  }, [draft.amend, draft.amendOid, details, repoId, update]);

  const over = draft.summary.length > SUMMARY_SOFT_LIMIT;
  const valid = canCommit(draft, stagedCount, headOid !== null);

  // Keep the focused field visible above the soft keyboard.
  const scroller = useRef<HTMLDivElement>(null);
  const onFocus = (e: React.FocusEvent) => {
    const el = e.target;
    window.setTimeout(() => el.scrollIntoView?.({ block: "center" }), 100);
  };

  const applyAiMessage = (text: string) => {
    const [first = "", ...rest] = text.trim().split("\n");
    update(repoId, { summary: first.trim(), body: rest.join("\n").trim() });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar
        repoId={repoId}
        title="Commit"
        actions={
          <>
            <IconButton aria-label="Close" onClick={() => nav.pop()}>
              <X />
            </IconButton>
            <Button
              variant="primary"
              disabled={!valid || pending}
              loading={pending}
              onClick={submit}
            >
              {draft.amend ? "Amend" : "Commit"}
            </Button>
          </>
        }
      />
      <div
        ref={scroller}
        data-scroll-root=""
        onFocusCapture={onFocus}
        style={{ paddingBottom: inset }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain bg-surface p-3"
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="composer-summary">Summary</Label>
            <span
              data-testid="summary-count"
              data-over={over || undefined}
              className={cn("font-mono text-sm", over ? "text-warning" : "text-fg-subtle")}
            >
              {draft.summary.length}/{SUMMARY_SOFT_LIMIT}
            </span>
          </div>
          <Input
            id="composer-summary"
            value={draft.summary}
            placeholder="Commit summary"
            aria-invalid={over ? "true" : undefined}
            autoCapitalize="sentences"
            enterKeyHint="next"
            onChange={(e) => update(repoId, { summary: e.target.value })}
          />
        </div>
        <AiCommitMessageButton
          repoId={repoId}
          onResult={applyAiMessage}
          disabled={!aiEnabled || (stagedCount === 0 && !draft.amend)}
          disabledReason={
            aiEnabled
              ? "Stage changes to draft a message"
              : "Enable AI in settings to draft messages"
          }
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="composer-body">Description</Label>
          <Textarea
            id="composer-body"
            value={draft.body}
            placeholder="Description (optional)"
            rows={5}
            autoCapitalize="sentences"
            enterKeyHint="enter"
            onChange={(e) => update(repoId, { body: e.target.value })}
          />
        </div>
        <label className="flex min-h-[var(--touch-target-row)] items-center justify-between gap-2 text-base">
          Amend last commit
          <Switch
            checked={draft.amend}
            onCheckedChange={(on) => setAmend(repoId, on)}
            disabled={!headOid}
            aria-label="Amend"
          />
        </label>
        <label className="flex min-h-[var(--touch-target-row)] items-center justify-between gap-2 text-base">
          Sign off
          <Switch
            checked={draft.signOff}
            onCheckedChange={(on) => update(repoId, { signOff: on })}
            aria-label="Sign-off"
          />
        </label>
        <button
          type="button"
          onClick={() => nav.pop()}
          className="flex min-h-[var(--touch-target-row)] items-center justify-between rounded-md text-base text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
        >
          <span data-testid="staged-summary">
            {stagedCount} staged file{stagedCount === 1 ? "" : "s"} (tap to review)
          </span>
          <ChevronRight className="size-4" aria-hidden />
        </button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      {sheet}
    </div>
  );
}
