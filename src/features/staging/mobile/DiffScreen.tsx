import { lazy, Suspense, useState } from "react";
import { ChevronDown, ChevronUp, FileX2 } from "lucide-react";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import type { RouteScreenProps } from "@/app/layout/registry";
import { EmptyState, IconButton, Spinner } from "@/design/components";
import { useStatus } from "@/ipc/queries";
import type { OpenFile } from "../FileList";
import { effectiveOpen } from "../effectiveOpen";

// The diff library (with syntax highlighting) is large: load it when a diff is first opened.
const DiffViewer = lazy(() =>
  import("../diff/DiffViewer").then((m) => ({ default: m.DiffViewer })),
);

/** Filename with the start truncated (the file name at the end is what matters). */
function StartTruncated({ text }: { text: string }) {
  return (
    <span className="block truncate text-left" style={{ direction: "rtl" }} title={text}>
      {`‎${text}`}
    </span>
  );
}

/** Unified diff of one changed file with hunk staging; follows the file across stage/unstage. */
export function DiffScreen({ repoId, route }: RouteScreenProps<"worktreeDiff">) {
  const status = useStatus(repoId);
  const [rawOpen, setOpen] = useState<OpenFile>({ path: route.path, staged: route.staged });
  const data = status.data;
  const open = data ? effectiveOpen(rawOpen, data) : rawOpen;

  const files: OpenFile[] = data
    ? [
        ...data.staged.map((f) => ({ path: f.path, staged: true })),
        ...data.unstaged.map((f) => ({ path: f.path, staged: false })),
      ]
    : [];
  const at = open ? files.findIndex((f) => f.path === open.path && f.staged === open.staged) : -1;
  const prev = at > 0 ? files[at - 1] : undefined;
  const next = at >= 0 ? files[at + 1] : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar
        repoId={repoId}
        back
        title={<StartTruncated text={open?.path ?? route.path} />}
        subtitle={open ? (open.staged ? "Staged" : "Unstaged") : undefined}
        actions={
          <>
            <IconButton
              aria-label="Previous file"
              disabled={!prev}
              onClick={() => prev && setOpen(prev)}
            >
              <ChevronUp />
            </IconButton>
            <IconButton
              aria-label="Next file"
              disabled={!next}
              onClick={() => next && setOpen(next)}
            >
              <ChevronDown />
            </IconButton>
          </>
        }
      />
      <div data-scroll-root="" className="min-h-0 flex-1 bg-surface">
        {open ? (
          <Suspense
            fallback={
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            }
          >
            <DiffViewer repoId={repoId} {...open} />
          </Suspense>
        ) : data ? (
          <EmptyState
            className="m-3"
            icon={<FileX2 />}
            title="No longer changed"
            description="This file has no uncommitted changes any more."
          />
        ) : (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        )}
      </div>
    </div>
  );
}
