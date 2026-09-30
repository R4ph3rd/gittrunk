import { useMemo, useState } from "react";
import { FileX2 } from "lucide-react";
import {
  Button,
  EmptyState,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@/design/components";
import type { FileDiff, LineSelection } from "@/ipc/bindings";
import {
  STAGING_DIFF_OPTIONS,
  useStageLines,
  useUnstageLines,
  useWorktreeDiff,
} from "@/ipc/queries";
import { useRepoStore, type DiffMode } from "@/stores/repo";
import { errorMessage, useDiscard } from "../ops";
import { HunkView } from "./HunkView";
import {
  buildHunkSelection,
  buildLineSelection,
  EMPTY_SELECTION,
  extendRange,
  selectedCount,
  toggleLine,
  type LineRef,
  type LineSelectionState,
} from "./selection";
import { countLines, toHunkStrings, visibleHunkCount } from "./toHunkStrings";
import { useDocTheme } from "./useDocTheme";

interface Props {
  repoId: string;
  path: string;
  staged: boolean;
}

/** Split/unified diff of one worktree or index file with hunk and line level staging. */
export function DiffViewer({ repoId, path, staged }: Props) {
  const query = useWorktreeDiff(repoId, path, staged);
  const mode = useRepoStore((s) => s.diffMode);
  const setMode = useRepoStore((s) => s.setDiffMode);
  const theme = useDocTheme();
  const stageLines = useStageLines(repoId);
  const unstageLines = useUnstageLines(repoId);
  const discard = useDiscard(repoId);
  const [showAll, setShowAll] = useState<FileDiff | null>(null);
  // Selection belongs to one fetched diff: any refetch (after staging) starts clean.
  const [sel, setSel] = useState<{ diff: FileDiff | null; state: LineSelectionState }>({
    diff: null,
    state: EMPTY_SELECTION,
  });

  const diff = query.data;
  const state = sel.diff === diff ? sel.state : EMPTY_SELECTION;
  const patches = useMemo(() => (diff ? toHunkStrings(diff) : []), [diff]);
  const busy = stageLines.isPending || unstageLines.isPending;

  if (query.isError) {
    return (
      <p role="alert" className="p-3 text-sm text-danger">
        {query.error.message}
      </p>
    );
  }
  if (!diff) {
    return (
      <div className="flex justify-center p-4">
        <Spinner />
      </div>
    );
  }

  const run = (kind: "stage" | "unstage", selection: LineSelection) => {
    const mutation = kind === "stage" ? stageLines : unstageLines;
    mutation.mutateAsync(selection).catch((e: unknown) => {
      toast.error(`Could not ${kind}: ${errorMessage(e)}`);
    });
  };
  const onLineClick = (ref: LineRef, shift: boolean) =>
    setSel({ diff, state: shift ? extendRange(diff, state, ref) : toggleLine(state, ref) });
  const lineSelection = buildLineSelection(path, STAGING_DIFF_OPTIONS, state);
  const hunkSel = (i: number) => buildHunkSelection(path, STAGING_DIFF_OPTIONS, i);

  const shown = visibleHunkCount(diff, showAll === diff);
  const hidden = diff.hunks.slice(shown).reduce((n, h) => n + h.lines.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="staging-diff">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
          {path}
        </span>
        <Tabs value={mode} onValueChange={(v) => setMode(v as DiffMode)}>
          <TabsList aria-label="Diff layout">
            <TabsTrigger value="unified">Unified</TabsTrigger>
            <TabsTrigger value="split">Split</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {selectedCount(state) > 0 && lineSelection && (
        <div
          role="toolbar"
          aria-label="Line selection"
          className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-accent-muted px-2 text-sm"
        >
          <span className="mr-auto">
            {selectedCount(state)} line{selectedCount(state) === 1 ? "" : "s"} selected
          </span>
          {staged ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => run("unstage", lineSelection)}
            >
              Unstage lines
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => run("stage", lineSelection)}
              >
                Stage lines
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => void discard.request({ kind: "lines", selection: lineSelection })}
              >
                Discard lines
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSel({ diff, state: EMPTY_SELECTION })}
          >
            Clear
          </Button>
        </div>
      )}
      <div className="gt-diff min-h-0 flex-1 overflow-auto">
        {diff.binary ? (
          <EmptyState
            className="m-3"
            icon={<FileX2 />}
            title="Binary file"
            description="A binary file has no textual diff. Stage or unstage it as a whole from the file list."
          />
        ) : diff.hunks.length === 0 ? (
          <EmptyState
            className="m-3"
            icon={<FileX2 />}
            title="No textual changes"
            description="Only metadata changed (for example the file mode)."
          />
        ) : (
          <>
            {diff.hunks.slice(0, shown).map((_, i) => (
              <HunkView
                key={i}
                diff={diff}
                hunkIndex={i}
                patch={patches[i] ?? ""}
                mode={mode}
                theme={theme}
                staged={staged}
                busy={busy}
                selectedKeys={state.keys}
                onLineClick={onLineClick}
                onStageHunk={(h) => run("stage", hunkSel(h))}
                onUnstageHunk={(h) => run("unstage", hunkSel(h))}
                onDiscardHunk={(h) =>
                  void discard.request({ kind: "lines", selection: hunkSel(h) })
                }
              />
            ))}
            {hidden > 0 && (
              <div className="flex items-center justify-center gap-2 p-3 text-sm text-fg-muted">
                <span>
                  Large diff: {hidden} of {countLines(diff)} lines not shown.
                </span>
                <Button size="sm" onClick={() => setShowAll(diff)}>
                  Show full diff
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {discard.dialog}
    </div>
  );
}
