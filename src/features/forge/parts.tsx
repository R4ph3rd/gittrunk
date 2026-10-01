import { useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { Avatar, Badge, Button, Spinner, Textarea, toast } from "@/design/components";
import { relativeDate, absoluteDate } from "@/features/graph/format";
import { isIpcError } from "@/ipc/client";
import type { ForgeComment, Issue } from "@/ipc/bindings";
import { useAvatar } from "@/ipc/queries";
import { cn } from "@/lib/cn";
import { commentsLabel, errorMessage, useOpenIntegrations } from "./helpers";

export function AddTokenButton() {
  const open = useOpenIntegrations();
  return (
    <Button size="sm" onClick={open}>
      Add a GitHub token
    </Button>
  );
}

/** Announces a failed forge call with the action that fits its kind. */
export function ForgeError({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: (() => void) | undefined;
  className?: string;
}) {
  const kind = isIpcError(error) ? error.kind : null;
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-2 text-sm", className)}>
      <span className="text-danger">{errorMessage(error)}</span>
      {kind === "authRequired" || kind === "authFailed" ? <AddTokenButton /> : null}
      {kind === "network" && onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function StateDot({ state }: { state: Issue["state"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        state === "open" ? "bg-success" : "bg-fg-subtle",
      )}
    />
  );
}

export function IssueStateBadge({ state }: { state: Issue["state"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm font-medium",
        state === "open" ? "text-success" : "text-fg-muted",
      )}
    >
      <StateDot state={state} />
      {state === "open" ? "Open" : "Closed"}
    </span>
  );
}

/** Desktop list row of an issue. */
export function IssueRow({ issue, onOpen }: { issue: Issue; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-1 border-b border-border px-4 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
      >
        <span className="flex items-center gap-2 text-base text-fg">
          <StateDot state={issue.state} />
          <span className="font-mono text-fg-muted">#{issue.number}</span>
          <span className="min-w-0 flex-1 truncate">{issue.title}</span>
          {issue.labels.map((l) => (
            <Badge key={l}>{l}</Badge>
          ))}
        </span>
        <span className="pl-4 text-sm text-fg-muted">
          {issue.author.login} · updated {relativeDate(issue.updatedAt)} ·{" "}
          {commentsLabel(issue.comments)}
        </span>
      </button>
    </li>
  );
}

/** A comment or issue body. The text is untrusted: rendered as plain text only. */
export function CommentItem({
  author,
  createdAt,
  body,
  emptyText,
}: {
  author: string;
  createdAt: number | null;
  body: string;
  emptyText?: string;
}) {
  const src = useAvatar({ kind: "githubLogin", login: author });
  return (
    <article className="flex gap-3 py-3">
      <Avatar name={author} src={src} size={28} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <header className="flex items-baseline gap-2 text-sm">
          <span className="font-medium text-fg">{author}</span>
          <time title={absoluteDate(createdAt)} className="text-fg-muted">
            {relativeDate(createdAt)}
          </time>
        </header>
        {body.trim() === "" && emptyText ? (
          <p className="text-base text-fg-muted">{emptyText}</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-base text-fg">{body}</p>
        )}
      </div>
    </article>
  );
}

export function CommentThread({ comments }: { comments: ForgeComment[] }) {
  if (comments.length === 0) return null;
  return (
    <div className="flex flex-col divide-y divide-border">
      {comments.map((c) => (
        <CommentItem key={c.id} author={c.author.login} createdAt={c.createdAt} body={c.body} />
      ))}
    </div>
  );
}

/** Plain textarea composer. Ctrl/Cmd+Enter submits; clears on success. */
export function CommentComposer({
  label,
  canWrite,
  onSubmit,
  className,
}: {
  label: string;
  canWrite: boolean;
  onSubmit: (body: string) => Promise<unknown>;
  className?: string;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    const text = body.trim();
    if (!text || pending || !canWrite) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(text);
      setBody("");
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className={cn("flex flex-col gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Textarea
        aria-label={label}
        value={body}
        disabled={!canWrite || pending}
        placeholder={canWrite ? label : "Add a GitHub token to comment"}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {error ? <ForgeError error={error} /> : null}
      <div className="flex items-center gap-2">
        {canWrite ? (
          <>
            <Button type="submit" variant="primary" size="sm" disabled={!body.trim() || pending}>
              {pending ? <Spinner label="Posting" /> : null}
              Comment
            </Button>
            <span className="text-xs text-fg-subtle">Ctrl+Enter to send</span>
          </>
        ) : (
          <>
            <span className="text-sm text-fg-muted">Commenting needs a GitHub token.</span>
            <AddTokenButton />
          </>
        )}
      </div>
    </form>
  );
}

export function CopyLinkButton({ url }: { url: string }) {
  return (
    <Button
      size="sm"
      onClick={() => {
        void navigator.clipboard
          .writeText(url)
          .then(() => toast.success("Link copied"))
          .catch((e: unknown) => toast.error(errorMessage(e)));
      }}
    >
      <Copy />
      Copy link
    </Button>
  );
}

/** One muted line, used for the non-ready gate states. */
export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-fg-muted">{children}</p>;
}
