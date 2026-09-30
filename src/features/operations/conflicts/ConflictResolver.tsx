import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Sparkles } from "lucide-react";
import {
  AlertDialog,
  Badge,
  Button,
  IconButton,
  Label,
  Spinner,
  Switch,
  toast,
} from "@/design/components";
import type { ConflictFile } from "@/ipc/bindings";
import { errorMessage } from "@/features/staging/ops";
import { useConflictFile, useConflictResolve } from "../queries";
import { ResultEditor, ReadOnlyPane, type ResultHandle } from "./ConflictEditor";
import { countConflicts } from "./markers";
import { useConflictSuggest, type ConflictSuggestFn } from "./suggest";

interface Props {
  repoId: string;
  path: string;
  onClose: () => void;
  /** Overrides the `ConflictSuggestProvider` value. */
  suggest?: ConflictSuggestFn;
}

const CRLF = /\r\n/;

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col border-r border-border last:border-r-0"
    >
      <h3 className="flex h-7 shrink-0 items-center truncate border-b border-border px-2 text-xs font-medium text-fg-muted">
        {title}
      </h3>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function ResolverBody({
  repoId,
  file,
  onClose,
  suggest,
}: {
  repoId: string;
  file: ConflictFile;
  onClose: () => void;
  suggest?: ConflictSuggestFn;
}) {
  const resolve = useConflictResolve(repoId);
  const handle = useRef<ResultHandle>(null);
  const [text, setText] = useState(file.merged.replace(/\r\n/g, "\n"));
  const [showBase, setShowBase] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const remaining = file.binary ? 0 : countConflicts(text);
  const crlf = CRLF.test(file.merged);

  const submit = (resolution: Parameters<typeof resolve.mutateAsync>[0]["resolution"]) =>
    resolve.mutateAsync({ path: file.path, resolution }).then(
      () => {
        toast.success(`Resolved ${file.path}`);
        onClose();
      },
      (e: unknown) => toast.error(`Could not resolve ${file.path}: ${errorMessage(e)}`),
    );

  const markResolved = () =>
    submit({ kind: "content", content: crlf ? text.replace(/\n/g, "\r\n") : text });

  const runSuggest = () => {
    if (!suggest) return;
    setSuggesting(true);
    suggest(file).then(
      (proposal) => {
        handle.current?.setText(proposal.replace(/\r\n/g, "\n"));
        setSuggesting(false);
      },
      (e: unknown) => {
        setSuggesting(false);
        toast.error(`Suggestion failed: ${errorMessage(e)}`);
      },
    );
  };

  const busy = resolve.isPending;
  const oursTitle = `Ours (${file.oursLabel})`;
  const theirsTitle = `Theirs (${file.theirsLabel})`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate font-mono text-sm" title={file.path}>
          {file.path}
        </span>
        <Badge variant="neutral">{file.oursLabel}</Badge>
        <span className="text-xs text-fg-subtle">vs</span>
        <Badge variant="accent">{file.theirsLabel}</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void submit({ kind: "ours" })}>
            Use ours
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void submit({ kind: "theirs" })}>
            Use theirs
          </Button>
          {!file.binary && suggest && (
            <Button size="sm" loading={suggesting} onClick={runSuggest}>
              <Sparkles />
              Suggest resolution
            </Button>
          )}
          {!file.binary && (
            <>
              <Button
                size="sm"
                variant="primary"
                disabled={busy || remaining > 0}
                onClick={() => void markResolved()}
              >
                Mark resolved
              </Button>
              {remaining > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmOpen(true)}
                >
                  Mark resolved anyway…
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {file.binary ? (
        <p className="rounded-md border border-border bg-bg-subtle p-3 text-sm text-fg-muted">
          This is a binary file and cannot be merged line by line. Keep one side with Use ours or
          Use theirs.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <IconButton
              aria-label="Previous conflict"
              size="sm"
              disabled={remaining === 0}
              onClick={() => handle.current?.prev()}
            >
              <ArrowUp />
            </IconButton>
            <IconButton
              aria-label="Next conflict"
              size="sm"
              disabled={remaining === 0}
              onClick={() => handle.current?.next()}
            >
              <ArrowDown />
            </IconButton>
            <span data-testid="conflicts-remaining" aria-live="polite">
              {remaining === 0
                ? "No conflicts remaining"
                : `${remaining} conflict${remaining === 1 ? "" : "s"} remaining`}
            </span>
            <span className="text-fg-subtle">Alt+Down / Alt+Up to navigate</span>
            <span className="ml-auto flex items-center gap-2">
              <Switch
                id="show-base"
                checked={showBase}
                onCheckedChange={setShowBase}
                disabled={file.base === null}
              />
              <Label htmlFor="show-base">Show base</Label>
            </span>
          </div>
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            {showBase && file.base !== null && (
              <Pane title="Base">
                <ReadOnlyPane value={file.base} path={file.path} label="Base" />
              </Pane>
            )}
            <Pane title={oursTitle}>
              <ReadOnlyPane value={file.ours ?? ""} path={file.path} label={oursTitle} />
            </Pane>
            <Pane title="Result">
              <ResultEditor initial={text} path={file.path} onChange={setText} handle={handle} />
            </Pane>
            <Pane title={theirsTitle}>
              <ReadOnlyPane value={file.theirs ?? ""} path={file.path} label={theirsTitle} />
            </Pane>
          </div>
        </>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Mark resolved with conflicts left?"
        description={`${remaining} conflict marker block${remaining === 1 ? "" : "s"} remain in ${file.path}. The markers will be committed as text.`}
        confirmLabel="Mark resolved anyway"
        onConfirm={() => void markResolved()}
      />
    </div>
  );
}

/** Three-way resolver for one conflicted file: ours | result (editable) | theirs, base optional. */
export function ConflictResolver({ repoId, path, onClose, suggest }: Props) {
  const query = useConflictFile(repoId, path);
  const contextSuggest = useConflictSuggest();
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {query.error.message}
      </p>
    );
  }
  if (!query.data) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }
  return (
    <ResolverBody
      key={query.data.path}
      repoId={repoId}
      file={query.data}
      onClose={onClose}
      suggest={suggest ?? contextSuggest}
    />
  );
}
