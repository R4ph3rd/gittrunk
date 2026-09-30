import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AiCommitMessageButton } from "@/features/ai";
import { Button, Input, Label, Switch, Textarea } from "@/design/components";
import { useAiEnabled, useCommitCreate, useCommitDetails, useRepoInfo } from "@/ipc/queries";
import { cn } from "@/lib/cn";
import { buildMessage, SUMMARY_SOFT_LIMIT } from "./message";
import { useOutcomeToast } from "./ops";

interface Props {
  repoId: string;
  stagedCount: number;
}

/** Summary, description, amend and sign-off; Ctrl/Cmd+Enter commits. */
export function CommitBox({ repoId, stagedCount }: Props) {
  const info = useRepoInfo(repoId);
  const aiEnabled = useAiEnabled();
  const commit = useCommitCreate(repoId);
  const notify = useOutcomeToast(repoId);
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [amend, setAmend] = useState(false);
  const [signOff, setSignOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = useRef<{ summary: string; body: string } | null>(null);

  const head = info.data?.head;
  const headOid = head && head.kind !== "unborn" ? head.oid : null;
  const headDetails = useCommitDetails(repoId, amend ? headOid : null);

  // Amend prefills the message of HEAD once it is loaded; turning it off restores the draft.
  const prefilled = useRef<string | null>(null);
  useEffect(() => {
    if (!amend) {
      prefilled.current = null;
      return;
    }
    const d = headDetails.data;
    if (d && prefilled.current !== d.oid) {
      prefilled.current = d.oid;
      setSummary(d.summary);
      setBody(d.body.trim());
    }
  }, [amend, headDetails.data]);

  const onAmend = (on: boolean) => {
    if (on) draft.current = { summary, body };
    else if (draft.current) {
      setSummary(draft.current.summary);
      setBody(draft.current.body);
      draft.current = null;
    }
    setAmend(on);
  };

  const trimmed = summary.trim();
  const noStaged = stagedCount === 0 && !amend;
  const disabled = commit.isPending || trimmed.length === 0 || noStaged || (amend && !headOid);
  const over = summary.length > SUMMARY_SOFT_LIMIT;
  const hint =
    trimmed.length === 0 ? "Enter a summary" : noStaged ? "Stage changes to commit" : null;

  // First line becomes the summary, the rest (after blank lines) the description.
  const applyAiMessage = (text: string) => {
    const [first = "", ...rest] = text.trim().split("\n");
    setSummary(first.trim());
    setBody(rest.join("\n").trim());
  };

  const submit = () => {
    if (disabled) return;
    setError(null);
    commit
      .mutateAsync({ message: buildMessage(summary, body), amend, signOff, allowEmpty: false })
      .then((outcome) => {
        setSummary("");
        setBody("");
        setAmend(false);
        draft.current = null;
        notify(outcome, amend ? "Commit amended" : "Committed");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      aria-label="Commit"
      onKeyDown={onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex shrink-0 flex-col gap-2 border-t border-border p-3"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="commit-summary">Summary</Label>
          <span className="flex items-center gap-1">
            <AiCommitMessageButton
              repoId={repoId}
              onResult={applyAiMessage}
              disabled={!aiEnabled || (stagedCount === 0 && !amend)}
              disabledReason={
                aiEnabled
                  ? "Stage changes to draft a message"
                  : "Enable AI in settings to draft messages"
              }
            />
            <span
              data-testid="summary-count"
              data-over={over || undefined}
              className={cn("font-mono text-xs", over ? "text-warning" : "text-fg-subtle")}
            >
              {summary.length}/{SUMMARY_SOFT_LIMIT}
            </span>
          </span>
        </div>
        <Input
          id="commit-summary"
          value={summary}
          placeholder="Commit summary"
          aria-invalid={over ? "true" : undefined}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>
      <Textarea
        aria-label="Description"
        value={body}
        placeholder="Description (optional)"
        rows={3}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <Switch
            checked={amend}
            onCheckedChange={onAmend}
            disabled={!headOid}
            aria-label="Amend"
          />
          Amend
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={signOff} onCheckedChange={setSignOff} aria-label="Sign-off" />
          Sign-off
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <span data-testid="commit-hint" className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
          {hint ?? `${stagedCount} staged · Ctrl+Enter to commit`}
        </span>
        <Button type="submit" variant="primary" disabled={disabled} loading={commit.isPending}>
          {amend ? "Amend commit" : "Commit"}
        </Button>
      </div>
    </form>
  );
}
