import { lazy, Suspense, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import type { RouteScreenProps } from "@/app/layout/registry";
import { Badge, Button, IconButton, Spinner, toast } from "@/design/components";
import { errorMessage } from "@/features/staging/ops";
import type { ConflictFile } from "@/ipc/bindings";
import { useNav } from "@/stores/nav";
import { useConflictFile, useConflictResolve } from "../../queries";
import { parseConflicts, resolveBlock, type BlockChoice } from "../markers";
import { useConflictSuggest } from "../suggest";

// CodeMirror is large: load the free-text editor only when "Edit manually" is used.
const ConflictResolver = lazy(() =>
  import("../ConflictResolver").then((m) => ({ default: m.ConflictResolver })),
);

const CRLF = /\r\n/;

function Side({ tone, label, lines }: { tone: "ours" | "theirs"; label: string; lines: string[] }) {
  return (
    <div
      data-side={tone}
      className={
        tone === "ours"
          ? "border-l-4 border-accent bg-accent-muted px-3 py-2"
          : "border-l-4 border-warning bg-bg-subtle px-3 py-2"
      }
    >
      <div className="mb-1 truncate text-xs font-medium text-fg-muted">
        {tone === "ours" ? "Ours" : "Theirs"} ({label})
      </div>
      <pre className="overflow-x-auto whitespace-pre font-mono text-sm text-fg">
        {lines.length ? lines.join("\n") : "(empty)"}
      </pre>
    </div>
  );
}

function Body({ repoId, file }: { repoId: string; file: ConflictFile }) {
  const nav = useNav();
  const resolve = useConflictResolve(repoId);
  const suggest = useConflictSuggest();
  const [text, setText] = useState(file.merged.replace(/\r\n/g, "\n"));
  const [suggesting, setSuggesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const crlf = CRLF.test(file.merged);
  const blocks = file.binary ? [] : parseConflicts(text);
  const busy = resolve.isPending;

  const submit = (resolution: Parameters<typeof resolve.mutateAsync>[0]["resolution"]) =>
    resolve.mutateAsync({ path: file.path, resolution }).then(
      () => {
        toast.success(`Resolved ${file.path}`);
        nav.pop();
      },
      (e: unknown) => toast.error(`Could not resolve ${file.path}: ${errorMessage(e)}`),
    );

  const submitText = (content: string) =>
    submit({ kind: "content", content: crlf ? content.replace(/\n/g, "\r\n") : content });

  /** Resolves one hunk; when it was the last one the file is written and marked resolved. */
  const choose = (index: number, choice: BlockChoice) => {
    const next = resolveBlock(text, index, choice);
    setText(next);
    if (parseConflicts(next).length === 0) void submitText(next);
  };

  const runSuggest = () => {
    if (!suggest) return;
    setSuggesting(true);
    suggest(file).then(
      (proposal) => {
        setText(proposal.replace(/\r\n/g, "\n"));
        setSuggesting(false);
      },
      (e: unknown) => {
        setSuggesting(false);
        toast.error(`Suggestion failed: ${errorMessage(e)}`);
      },
    );
  };

  if (editing) {
    return (
      <div className="fixed inset-0 z-[var(--z-modal)] flex flex-col bg-surface pt-[var(--safe-top)]">
        <div className="flex min-h-[var(--touch-target)] items-center gap-2 border-b border-border px-2">
          <IconButton aria-label="Close editor" onClick={() => setEditing(false)}>
            <X />
          </IconButton>
          <span className="min-w-0 flex-1 truncate font-mono text-sm">{file.path}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-2">
          <Suspense
            fallback={
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            }
          >
            <ConflictResolver repoId={repoId} path={file.path} onClose={() => nav.pop()} />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div data-scroll-root="" className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Badge variant="accent">{file.oursLabel}</Badge>
        <span className="text-xs text-fg-subtle">vs</span>
        <Badge variant="neutral">{file.theirsLabel}</Badge>
        <span
          data-testid="conflicts-remaining"
          aria-live="polite"
          className="ml-auto text-sm text-fg-muted"
        >
          {file.binary
            ? "Binary file"
            : blocks.length === 0
              ? "No conflicts remaining"
              : `${blocks.length} conflict${blocks.length === 1 ? "" : "s"} remaining`}
        </span>
      </div>

      {file.binary ? (
        <p className="mx-3 rounded-md border border-border bg-bg-subtle p-3 text-sm text-fg-muted">
          This is a binary file and cannot be merged line by line. Keep one side.
        </p>
      ) : (
        blocks.map((block, i) => (
          <section
            key={`${block.from}:${i}`}
            aria-label={`Conflict ${i + 1} of ${blocks.length}`}
            className="mx-3 mb-3 flex flex-col gap-2 rounded-md border border-border p-2"
          >
            <h3 className="text-sm font-medium text-fg-muted">
              Conflict {i + 1} of {blocks.length}
            </h3>
            <Side tone="ours" label={block.oursLabel || file.oursLabel} lines={block.ours} />
            <Side
              tone="theirs"
              label={block.theirsLabel || file.theirsLabel}
              lines={block.theirs}
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => choose(i, "ours")}>
                Use ours
              </Button>
              <Button disabled={busy} onClick={() => choose(i, "theirs")}>
                Use theirs
              </Button>
              <Button disabled={busy} onClick={() => choose(i, "both")}>
                Both
              </Button>
            </div>
          </section>
        ))
      )}

      <div className="mt-auto flex flex-col gap-2 border-t border-border p-3">
        {file.binary || blocks.length > 0 ? (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() => void submit({ kind: "ours" })}
            >
              {file.binary ? "Use ours" : "Whole file: ours"}
            </Button>
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() => void submit({ kind: "theirs" })}
            >
              {file.binary ? "Use theirs" : "Whole file: theirs"}
            </Button>
          </div>
        ) : null}
        {!file.binary && (
          <>
            {blocks.length === 0 && (
              <Button
                variant="primary"
                disabled={busy}
                loading={busy}
                onClick={() => void submitText(text)}
              >
                Mark resolved
              </Button>
            )}
            <div className="flex gap-2">
              {suggest && (
                <Button className="flex-1" loading={suggesting} onClick={runSuggest}>
                  <Sparkles />
                  Suggest with AI
                </Button>
              )}
              <Button className="flex-1" onClick={() => setEditing(true)}>
                Edit manually
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One conflicted file: each conflict hunk as ours/theirs cards with per-hunk resolution. */
export function ConflictFileScreen({ repoId, route }: RouteScreenProps<"conflict">) {
  const query = useConflictFile(repoId, route.path);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar repoId={repoId} back title={route.path} />
      {query.isError ? (
        <p role="alert" className="p-3 text-sm text-danger">
          {query.error.message}
        </p>
      ) : !query.data ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : (
        <Body key={query.data.path} repoId={repoId} file={query.data} />
      )}
    </div>
  );
}
