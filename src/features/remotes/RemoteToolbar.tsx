import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  GitBranchPlus,
  RefreshCw,
  Redo2,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  toast,
} from "@/design/components";
import { formatShortcut } from "@/app/shortcuts";
import { useRepoBusy } from "@/features/ops/store";
import { useOplogState, useRefs, useStatus, invalidateEverything } from "@/ipc/queries";
import type { PullStrategy } from "@/ipc/bindings";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { updateSettings, useSettings } from "@/stores/settings";
import { useRemotesUi } from "@/stores/remotes";
import { useDndStore } from "@/stores/dnd";
import { useRepoStore } from "@/stores/repo";
import { usePlatform } from "@/app/platform";
import { fetchRemote, headBranch, pullCurrent, pushBranch, STRATEGY_LABEL } from "./actions";

const STRATEGIES: PullStrategy[] = ["merge", "rebase", "ffOnly"];

function Count({ n, label }: { n: number; label: string }) {
  if (n <= 0) return null;
  return (
    <span className="font-mono text-xs text-fg-muted" aria-label={`${n} ${label}`}>
      {n}
    </span>
  );
}

/** Fetch, Pull and Push for the active repository with ahead/behind counts. */
export function RemoteToolbar({ repoId }: { repoId: string }) {
  const client = useQueryClient();
  const refs = useRefs(repoId);
  const status = useStatus(repoId);
  const busy = useRepoBusy(repoId);
  const strategy = useSettings().pullStrategy;
  const oplogState = useOplogState(repoId);
  const setForcePushFor = useRemotesUi((s) => s.setForcePushFor);
  const setOplogPreview = useRemotesUi((s) => s.setOplogPreview);
  const platform = usePlatform();

  const branch = headBranch(refs.data);
  const canPull = !busy && !!branch?.upstream;
  const canPush = !busy && !!branch;
  const isHeadUnborn = refs.data?.head.kind === "unborn";
  const canCreateBranch = !busy && !isHeadUnborn;
  const canStash =
    !busy && (status.data?.unstaged.length ?? 0) + (status.data?.conflicted.length ?? 0) > 0;

  const handleUndo = async () => {
    try {
      const outcome = await unwrap(commands.undo(repoId, true));
      if (outcome.kind === "preview") {
        setOplogPreview({ repoId, preview: outcome.preview, mode: "undo" });
      } else {
        void invalidateEverything(client, repoId);
      }
    } catch (e) {
      toast.error(`Nothing to undo: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRedo = async () => {
    try {
      const outcome = await unwrap(commands.redo(repoId, true));
      if (outcome.kind === "preview") {
        setOplogPreview({ repoId, preview: outcome.preview, mode: "redo" });
      } else {
        void invalidateEverything(client, repoId);
      }
    } catch (e) {
      toast.error(`Nothing to redo: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleBranch = () => {
    const headOid =
      refs.data?.head.kind === "branch"
        ? refs.data.head.oid
        : refs.data?.head.kind === "detached"
          ? refs.data.head.oid
          : "";
    const label =
      refs.data?.head.kind === "branch"
        ? refs.data.head.name
        : refs.data?.head.kind === "detached"
          ? refs.data.head.oid.slice(0, 7)
          : "";
    useDndStore.getState().setPrompt({ kind: "branch", repoId, startPoint: headOid, label });
  };

  const handleStash = () => {
    useRepoStore.getState().setStashDialog(repoId, true);
  };

  const handlePullFfOnly = () => void pullCurrent(client, repoId, "ffOnly");

  return (
    <div
      role="toolbar"
      aria-label="Remote operations"
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-toolbar px-3"
    >
      {/* Undo/Redo split button (read-write only) */}
      {!platform.readOnly && (
        <div className="flex items-center gap-px">
          <Tooltip
            content={
              oplogState.data?.undoDescription
                ? `Undo: ${oplogState.data.undoDescription}`
                : "Undo last operation"
            }
            shortcut={formatShortcut("mod+z")}
          >
            <Button
              disabled={!oplogState.data?.canUndo || busy}
              className="rounded-r-none"
              onClick={() => void handleUndo()}
            >
              <Undo2 />
              Undo
            </Button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label="Undo options"
                variant="secondary"
                disabled={!oplogState.data?.canRedo || busy}
                className="w-6 rounded-l-none"
              >
                <ChevronDown />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={!oplogState.data?.canRedo}
                icon={<Redo2 />}
                onSelect={() => void handleRedo()}
              >
                Redo
                {oplogState.data?.redoDescription ? `: ${oplogState.data.redoDescription}` : ""}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <Tooltip content="Fetch all remotes and prune" shortcut={formatShortcut("mod+alt+f")}>
        <Button disabled={busy} onClick={() => void fetchRemote(repoId, null)}>
          <RefreshCw />
          Fetch
        </Button>
      </Tooltip>

      <div className="flex items-center gap-px">
        <Tooltip
          content={
            platform.readOnly
              ? "Fast-forward only (read-only mode)"
              : branch?.upstream
                ? `Pull ${branch.upstream}`
                : "No upstream branch to pull"
          }
          shortcut={formatShortcut("mod+shift+l")}
        >
          <Button
            disabled={!canPull}
            className={platform.readOnly ? "" : "rounded-r-none"}
            onClick={() =>
              platform.readOnly ? handlePullFfOnly() : void pullCurrent(client, repoId, strategy)
            }
          >
            <ArrowDown />
            Pull
            <Count n={branch?.behind ?? 0} label="behind" />
          </Button>
        </Tooltip>
        {!platform.readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label="Pull options"
                variant="secondary"
                disabled={!canPull}
                className="w-6 rounded-l-none"
              >
                <ChevronDown />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Pull strategy</DropdownMenuLabel>
              {STRATEGIES.map((s) => (
                <DropdownMenuItem
                  key={s}
                  icon={s === strategy ? <Check /> : <span className="size-3.5" aria-hidden />}
                  onSelect={() => {
                    void updateSettings({ pullStrategy: s });
                    void pullCurrent(client, repoId, s);
                  }}
                >
                  {STRATEGY_LABEL[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {!platform.readOnly && (
        <>
          <div className="flex items-center gap-px">
            <Tooltip
              content={branch?.upstream ? `Push to ${branch.upstream}` : "Push and set upstream"}
              shortcut={formatShortcut("mod+shift+k")}
            >
              <Button
                disabled={!canPush}
                className="rounded-r-none"
                onClick={() => void pushBranch(client, repoId)}
              >
                <ArrowUp />
                Push
                <Count n={branch?.ahead ?? 0} label="ahead" />
              </Button>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="Push options"
                  variant="secondary"
                  disabled={!canPush}
                  className="w-6 rounded-l-none"
                >
                  <ChevronDown />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  destructive
                  icon={<TriangleAlert />}
                  disabled={!branch?.upstream}
                  onSelect={() => setForcePushFor(repoId)}
                >
                  Force push with lease…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Tooltip content="Create branch at HEAD" shortcut={formatShortcut("mod+shift+b")}>
            <Button disabled={!canCreateBranch} onClick={() => handleBranch()}>
              <GitBranchPlus />
              Branch
            </Button>
          </Tooltip>

          <Tooltip content="Stash working copy" shortcut={formatShortcut("mod+shift+s")}>
            <Button disabled={!canStash} onClick={() => handleStash()}>
              <Archive />
              Stash
            </Button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
