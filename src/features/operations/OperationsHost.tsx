import { lazy, Suspense, useEffect, useRef } from "react";
import { GitPullRequestArrow, Play, SkipForward, Undo2 } from "lucide-react";
import { useRegisterCommands, type Command, type CommandContext } from "@/app/commands";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
  toast,
} from "@/design/components";
import type { RepoInfo } from "@/ipc/bindings";
import { queryKeys } from "@/ipc/queries";
import { selectedOidOf, useRepoStore } from "@/stores/repo";
import { useOperationsStore } from "@/stores/operations";
import { RebaseEditor } from "./rebase/RebaseEditor";
import { canSkip, isSequencerState, useSequencerActions } from "./sequencer/actions";

// CodeMirror is large: load the resolver when a conflict is first opened.
const ConflictResolver = lazy(() =>
  import("./conflicts/ConflictResolver").then((m) => ({ default: m.ConflictResolver })),
);

export const OPEN_REBASE_EDITOR_EVENT = "gittrunk:open-rebase-editor";

export interface OpenRebaseEditorDetail {
  repoId: string;
  /** Exclusive base commit: the commits above it are edited. */
  base: string;
}

const stateOf = (ctx: CommandContext): RepoInfo["state"] | null =>
  ctx.repoId
    ? (ctx.queryClient.getQueryData<RepoInfo>(queryKeys.info(ctx.repoId))?.state ?? null)
    : null;

/** Mounts the conflict resolver and rebase editor dialogs and registers the operation commands. */
export function OperationsHost({ repoId }: { repoId: string }) {
  const resolverPath = useOperationsStore((s) => s.resolver[repoId] ?? null);
  const rebaseBase = useOperationsStore((s) => s.rebase[repoId] ?? null);
  const closeConflict = useOperationsStore((s) => s.closeConflict);
  const closeRebase = useOperationsStore((s) => s.closeRebase);
  const actions = useSequencerActions(repoId);
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenRebaseEditorDetail>).detail;
      if (detail?.repoId === repoId && detail.base) {
        useOperationsStore.getState().openRebase(repoId, detail.base);
      }
    };
    window.addEventListener(OPEN_REBASE_EDITOR_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_REBASE_EDITOR_EVENT, onOpen);
  }, [repoId]);

  const inOperation = (ctx: CommandContext) => {
    const s = stateOf(ctx);
    return s !== null && isSequencerState(s);
  };
  const commands: Command[] = [
    {
      id: "operation.continue",
      title: "Continue operation",
      group: "Operation",
      icon: Play,
      keywords: ["rebase", "merge", "cherry-pick", "revert"],
      when: inOperation,
      run: async (ctx) => {
        if (!ctx.repoId) return;
        const conflicts = ctx.queryClient.getQueryData<{ conflicted: unknown[] }>(
          queryKeys.status(ctx.repoId),
        )?.conflicted;
        if (conflicts && conflicts.length > 0) {
          toast.error("Resolve all conflicts before continuing");
          return;
        }
        await latest.current.run("continue");
      },
    },
    {
      id: "operation.skip",
      title: "Skip operation step",
      group: "Operation",
      icon: SkipForward,
      keywords: ["rebase", "cherry-pick", "revert"],
      when: (ctx) => {
        const s = stateOf(ctx);
        return s !== null && canSkip(s);
      },
      run: async () => {
        await latest.current.run("skip");
      },
    },
    {
      id: "operation.abort",
      title: "Abort operation",
      group: "Operation",
      icon: Undo2,
      keywords: ["cancel", "rebase", "merge"],
      when: inOperation,
      run: (ctx) => {
        if (ctx.repoId) useOperationsStore.getState().setAbortConfirm(ctx.repoId, true);
      },
    },
    {
      id: "rebase.interactive",
      title: "Interactive rebase…",
      group: "Operation",
      icon: GitPullRequestArrow,
      keywords: ["squash", "reword", "reorder", "history"],
      when: (ctx) => ctx.repoId !== null && stateOf(ctx) === "clean",
      run: (ctx) => {
        if (!ctx.repoId) return;
        const base = selectedOidOf(useRepoStore.getState().selection[ctx.repoId]);
        if (!base) {
          toast.error("Select the commit to rebase onto in the graph first");
          return;
        }
        useOperationsStore.getState().openRebase(ctx.repoId, base);
      },
    },
  ];
  useRegisterCommands(commands, []);

  return (
    <>
      <Dialog open={resolverPath !== null} onOpenChange={(open) => !open && closeConflict(repoId)}>
        <DialogContent className="flex h-[calc(100vh-48px)] w-[calc(100vw-48px)] max-w-none flex-col">
          <DialogHeader>
            <DialogTitle>Resolve conflict</DialogTitle>
            <DialogDescription>
              Pick a side per conflict block, edit the result, then mark the file resolved.
            </DialogDescription>
          </DialogHeader>
          {resolverPath !== null && (
            <Suspense fallback={<Spinner />}>
              <ConflictResolver
                repoId={repoId}
                path={resolverPath}
                onClose={() => closeConflict(repoId)}
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
      {rebaseBase !== null && (
        <RebaseEditor repoId={repoId} base={rebaseBase} onClose={() => closeRebase(repoId)} />
      )}
    </>
  );
}
