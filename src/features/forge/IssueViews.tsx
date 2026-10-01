import { useState } from "react";
import { Button, Input, Spinner, Textarea } from "@/design/components";
import { absoluteDate, relativeDate } from "@/features/graph/format";
import type { Issue } from "@/ipc/bindings";
import { useAddIssueComment, useCreateIssue, useIssue } from "@/ipc/queries";
import { commentsLabel } from "./helpers";
import {
  AddTokenButton,
  CommentComposer,
  CommentItem,
  CommentThread,
  CopyLinkButton,
  ForgeError,
  IssueStateBadge,
  Muted,
} from "./parts";

/** Issue header, description and comments. Content only: pair with `IssueComposer`. */
export function IssueBody({ repoId, number }: { repoId: string; number: number }) {
  const query = useIssue(repoId, number);
  if (query.isPending) {
    return (
      <div className="p-4">
        <Spinner label="Loading issue" />
      </div>
    );
  }
  if (query.isError) {
    return <ForgeError className="p-4" error={query.error} onRetry={() => void query.refetch()} />;
  }
  const { issue, body, comments } = query.data;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-col gap-1">
        <h2 className="break-words text-xl font-semibold text-fg">
          {issue.title} <span className="font-mono text-fg-muted">#{issue.number}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
          <IssueStateBadge state={issue.state} />
          <span title={absoluteDate(issue.createdAt)}>
            {issue.author.login} opened {relativeDate(issue.createdAt)}
          </span>
          <span>{commentsLabel(issue.comments)}</span>
          <CopyLinkButton url={issue.url} />
        </div>
      </div>
      <div className="border-y border-border">
        <CommentItem
          author={issue.author.login}
          createdAt={issue.createdAt}
          body={body}
          emptyText="No description provided."
        />
      </div>
      <CommentThread comments={comments} />
    </div>
  );
}

export function IssueComposer({
  repoId,
  number,
  canWrite,
  className,
}: {
  repoId: string;
  number: number;
  canWrite: boolean;
  className?: string;
}) {
  const add = useAddIssueComment(repoId, number);
  return (
    <CommentComposer
      label="Add a comment"
      canWrite={canWrite}
      onSubmit={(body) => add.mutateAsync(body)}
      className={className ?? ""}
    />
  );
}

export const TITLE_MAX = 256;

/** Title (required, max 256) and description. `onCreated` runs after a successful create. */
export function NewIssueForm({
  repoId,
  canWrite,
  onCreated,
  onCancel,
}: {
  repoId: string;
  canWrite: boolean;
  onCreated: (issue: Issue) => void;
  onCancel: () => void;
}) {
  const create = useCreateIssue(repoId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    const t = title.trim();
    if (!t) return setInvalid("Title is required");
    if (t.length > TITLE_MAX) return setInvalid(`Title must be at most ${TITLE_MAX} characters`);
    setInvalid(null);
    setError(null);
    try {
      onCreated(await create.mutateAsync({ title: t, body }));
    } catch (e) {
      setError(e);
    }
  };

  return (
    <form
      aria-label="New issue"
      className="flex flex-col gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {!canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          <Muted>Creating an issue needs a GitHub token.</Muted>
          <AddTokenButton />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="new-issue-title" className="text-sm font-medium text-fg">
          Title
        </label>
        <Input
          id="new-issue-title"
          value={title}
          maxLength={TITLE_MAX}
          aria-required
          aria-invalid={invalid ? true : undefined}
          disabled={!canWrite}
          onChange={(e) => {
            setTitle(e.target.value);
            setInvalid(null);
          }}
        />
        {invalid ? (
          <p role="alert" className="text-sm text-danger">
            {invalid}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="new-issue-body" className="text-sm font-medium text-fg">
          Description
        </label>
        <Textarea
          id="new-issue-body"
          value={body}
          rows={8}
          disabled={!canWrite}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </div>
      {error ? <ForgeError error={error} /> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={!canWrite || create.isPending}>
          {create.isPending ? <Spinner label="Creating" /> : null}
          Submit
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
