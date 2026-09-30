import { useEffect, useRef } from "react";
import { Archive, CheckCircle2 } from "lucide-react";
import type { TabScreenProps } from "@/app/layout/registry";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import { Button, EmptyState, IconButton, PullToRefresh, Spinner, toast } from "@/design/components";
import type { FileChange } from "@/ipc/bindings";
import { useStagePaths, useStatus, useUnstagePaths } from "@/ipc/queries";
import { useNav } from "@/stores/nav";
import { useRepoStore } from "@/stores/repo";
import { errorMessage, useDiscard } from "../ops";
import { ComposerBar } from "./ComposerBar";
import { FileRow, type FileSection } from "./FileRow";

/** Changes tab: staged and unstaged files with swipe actions, and the sticky composer bar. */
export function ChangesScreen({ repoId }: TabScreenProps) {
  const nav = useNav();
  const status = useStatus(repoId);
  const stage = useStagePaths(repoId);
  const unstage = useUnstagePaths(repoId);
  const discard = useDiscard(repoId);
  const setStashDialog = useRepoStore((s) => s.setStashDialog);

  const fail = (what: string) => (e: unknown) =>
    toast.error(`Could not ${what}: ${errorMessage(e)}`);
  const stagePaths = (paths: string[]) => {
    if (paths.length) stage.mutateAsync(paths).catch(fail("stage"));
  };
  const unstagePaths = (paths: string[]) => {
    if (paths.length) unstage.mutateAsync(paths).catch(fail("unstage"));
  };

  // `PullToRefresh` owns the scroller; mark it so re-tapping the tab scrolls it to the top.
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current?.firstElementChild?.setAttribute("data-scroll-root", "");
  }, []);

  const data = status.data;
  const total = data ? data.staged.length + data.unstaged.length + data.conflicted.length : 0;

  const section = (
    id: FileSection,
    title: string,
    files: FileChange[],
    action?: { label: string; run: () => void },
  ) =>
    files.length > 0 && (
      <section aria-label={title} data-testid={`section-${id}`}>
        <header className="flex min-h-[var(--touch-target)] items-center gap-2 px-3 text-xs font-medium uppercase tracking-wide text-fg-subtle">
          {title}
          <span className="font-mono">{files.length}</span>
          {action && (
            <Button size="sm" variant="ghost" className="ml-auto normal-case" onClick={action.run}>
              {action.label}
            </Button>
          )}
        </header>
        {files.map((file) => (
          <FileRow
            key={`${id}:${file.path}`}
            section={id}
            file={file}
            onOpen={() =>
              id === "conflicted"
                ? nav.push({ name: "conflict", path: file.path })
                : nav.push({ name: "worktreeDiff", path: file.path, staged: id === "staged" })
            }
            onStage={() => stagePaths([file.path])}
            onUnstage={() => unstagePaths([file.path])}
            onDiscard={() => void discard.request({ kind: "paths", paths: [file.path] })}
          />
        ))}
      </section>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar
        repoId={repoId}
        actions={
          <IconButton aria-label="Stash changes" onClick={() => setStashDialog(repoId, true)}>
            <Archive />
          </IconButton>
        }
      />
      <div ref={host} className="flex min-h-0 flex-1 flex-col">
        <PullToRefresh className="flex-1 bg-surface" onRefresh={() => status.refetch()}>
          {!data ? (
            <div className="flex justify-center p-6">
              {status.isError ? (
                <p role="alert" className="text-sm text-danger">
                  {status.error.message}
                </p>
              ) : (
                <Spinner />
              )}
            </div>
          ) : total === 0 ? (
            <EmptyState
              className="m-3"
              icon={<CheckCircle2 />}
              title="Working tree clean"
              description="Nothing to commit."
            />
          ) : (
            <div aria-label="Changed files" role="group">
              {section("conflicted", "Conflicted", data.conflicted)}
              {section("staged", "Staged", data.staged, {
                label: "Unstage all",
                run: () => unstagePaths(data.staged.map((f) => f.path)),
              })}
              {section("unstaged", "Unstaged", data.unstaged, {
                label: "Stage all",
                run: () => stagePaths(data.unstaged.map((f) => f.path)),
              })}
            </div>
          )}
        </PullToRefresh>
      </div>
      <ComposerBar repoId={repoId} stagedCount={data?.staged.length ?? 0} />
      {discard.dialog}
    </div>
  );
}
