import {
  ArrowDown,
  ArrowUp,
  CopyPlus,
  Download,
  GitCommitHorizontal,
  Layers,
  Plus,
  RefreshCw,
  Undo2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRegisterCommands, type Command, type CommandContext } from "@/app/commands";
import { AlertDialog, toast } from "@/design/components";
import { useOpEvents } from "@/features/ops/ops";
import { useOpsStore } from "@/features/ops/store";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateEverything, invalidateWorkingCopy, queryKeys } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { useRemotesUi } from "@/stores/remotes";
import { fetchRemote, pullCurrent, pushBranch } from "./actions";
import { CloneDialog } from "./CloneDialog";
import { CredentialPrompt } from "./CredentialPrompt";
import { useCredentialEvents } from "./credentials";
import { PushDialog } from "./PushDialog";
import { RemoteFormDialog } from "./RemoteFormDialog";

const hasRepo = (ctx: CommandContext) => ctx.repoId !== null;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs `fn` with the active repo unless one of its operations is already running. */
function withIdleRepo(fn: (repoId: string, ctx: CommandContext) => void | Promise<void>) {
  return (ctx: CommandContext) => {
    const id = ctx.repoId;
    if (!id) return;
    if (Object.values(useOpsStore.getState().ops).some((o) => o.repoId === id)) {
      toast.info("Another operation is still running");
      return;
    }
    return fn(id, ctx);
  };
}

async function stageAll(ctx: CommandContext) {
  const id = ctx.repoId;
  if (!id) return;
  try {
    const status = await ctx.queryClient.fetchQuery({
      queryKey: queryKeys.status(id),
      queryFn: () => unwrap(commands.status(id)),
      staleTime: 0,
    });
    const paths = [...new Set([...status.unstaged, ...status.conflicted].map((f) => f.path))];
    if (paths.length === 0) {
      toast.info("Nothing to stage");
      return;
    }
    await unwrap(commands.stagePaths(id, paths));
    toast.success(`Staged ${paths.length} file${paths.length === 1 ? "" : "s"}`);
  } catch (e) {
    toast.error(`Could not stage: ${message(e)}`);
  } finally {
    void invalidateWorkingCopy(ctx.queryClient, id);
  }
}

/** Selects the WIP row, then focuses the commit summary once the staging panel has mounted. */
function focusCommitBox(ctx: CommandContext) {
  const id = ctx.repoId;
  if (!id) return;
  useRepoStore.getState().selectWip(id);
  let tries = 0;
  const attempt = () => {
    const input = document.getElementById("commit-summary");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    } else if (tries++ < 20) {
      setTimeout(attempt, 25);
    }
  };
  attempt();
}

async function undoPreview(ctx: CommandContext) {
  const id = ctx.repoId;
  if (!id) return;
  try {
    const outcome = await unwrap(commands.undo(id, true));
    if (outcome.kind === "preview") {
      useRemotesUi.getState().setUndoPreview({ repoId: id, preview: outcome.preview });
    } else {
      void invalidateEverything(ctx.queryClient, id);
    }
  } catch (e) {
    toast.error(`Nothing to undo: ${message(e)}`);
  }
}

function useRemoteCommands() {
  const list: Command[] = [
    {
      id: "remote.fetch",
      title: "Fetch all remotes",
      group: "Remotes",
      icon: RefreshCw,
      shortcut: "mod+alt+f",
      keywords: ["prune", "download", "sync"],
      when: hasRepo,
      run: withIdleRepo((id) => void fetchRemote(id, null)),
    },
    {
      id: "remote.pull",
      title: "Pull",
      group: "Remotes",
      icon: ArrowDown,
      shortcut: "mod+shift+l",
      keywords: ["merge", "rebase", "update"],
      when: hasRepo,
      run: withIdleRepo((id, ctx) => void pullCurrent(ctx.queryClient, id)),
    },
    {
      id: "remote.push",
      title: "Push",
      group: "Remotes",
      icon: ArrowUp,
      shortcut: "mod+shift+k",
      keywords: ["upload", "publish", "upstream"],
      when: hasRepo,
      run: withIdleRepo((id, ctx) => void pushBranch(ctx.queryClient, id)),
    },
    {
      id: "remote.add",
      title: "Add remote",
      group: "Remotes",
      icon: Plus,
      when: hasRepo,
      run: (ctx) => useRemotesUi.getState().setAddRemoteFor(ctx.repoId),
    },
    {
      id: "repo.clone",
      title: "Clone repository",
      group: "Repository",
      icon: CopyPlus,
      shortcut: "mod+shift+o",
      keywords: ["download", "git url"],
      run: () => useRemotesUi.getState().setCloneOpen(true),
    },
    {
      id: "staging.stageAll",
      title: "Stage all changes",
      group: "Working copy",
      icon: Layers,
      shortcut: "mod+shift+a",
      keywords: ["add", "index"],
      when: hasRepo,
      run: stageAll,
    },
    {
      id: "staging.commit",
      title: "Commit",
      group: "Working copy",
      icon: GitCommitHorizontal,
      keywords: ["message", "summary", "wip"],
      when: hasRepo,
      run: focusCommitBox,
    },
    {
      id: "stash.save",
      title: "Stash changes",
      group: "Working copy",
      icon: Download,
      keywords: ["shelve", "save"],
      when: hasRepo,
      run: (ctx) => {
        if (ctx.repoId) useRepoStore.getState().setStashDialog(ctx.repoId, true);
      },
    },
    {
      id: "history.undo",
      title: "Undo last operation",
      group: "History",
      icon: Undo2,
      shortcut: "mod+z",
      keywords: ["revert", "oplog"],
      when: hasRepo,
      run: undoPreview,
    },
  ];
  useRegisterCommands(list, []);
}

function UndoDialog() {
  const client = useQueryClient();
  const state = useRemotesUi((s) => s.undoPreview);
  const setState = useRemotesUi((s) => s.setUndoPreview);

  const confirm = async () => {
    if (!state) return;
    try {
      const outcome = await unwrap(commands.undo(state.repoId, false));
      toast.success(outcome.kind === "applied" && outcome.message ? outcome.message : "Undone");
    } catch (e) {
      toast.error(`Undo failed: ${message(e)}`);
    } finally {
      void invalidateEverything(client, state.repoId);
    }
  };

  return (
    <AlertDialog
      open={state !== null}
      onOpenChange={(open) => !open && setState(null)}
      title="Undo last operation?"
      description="This reverts the most recent change made through gittrunk."
      preview={
        state ? (
          <div className="flex flex-col gap-2">
            <p className="whitespace-pre-wrap text-fg">{state.preview.summary}</p>
            {state.preview.warnings.map((w) => (
              <p key={w} className="text-warning">
                {w}
              </p>
            ))}
          </div>
        ) : null
      }
      confirmLabel="Undo"
      destructive
      onConfirm={() => void confirm()}
    />
  );
}

function ForcePushDialog() {
  const client = useQueryClient();
  const repoId = useRemotesUi((s) => s.forcePushFor);
  const setRepoId = useRemotesUi((s) => s.setForcePushFor);
  return (
    <AlertDialog
      open={repoId !== null}
      onOpenChange={(open) => !open && setRepoId(null)}
      title="Force push with lease?"
      description="This overwrites the remote branch with your local history. It is refused if someone else pushed in the meantime, but commits only on the remote will be lost."
      confirmLabel="Force push"
      destructive
      onConfirm={() => {
        if (repoId) void pushBranch(client, repoId, { forceWithLease: true });
      }}
    />
  );
}

/**
 * App-level host for the remotes feature: event subscriptions, palette commands and the
 * dialogs that commands open. Render once inside the app shell.
 */
export function RemotesHost() {
  useOpEvents();
  useCredentialEvents();
  useRemoteCommands();
  const addRemoteFor = useRemotesUi((s) => s.addRemoteFor);
  const setAddRemoteFor = useRemotesUi((s) => s.setAddRemoteFor);
  return (
    <>
      <CredentialPrompt />
      <CloneDialog />
      <PushDialog />
      <ForcePushDialog />
      <UndoDialog />
      {addRemoteFor && (
        <RemoteFormDialog
          repoId={addRemoteFor}
          mode={{ kind: "add" }}
          onClose={() => setAddRemoteFor(null)}
        />
      )}
    </>
  );
}
