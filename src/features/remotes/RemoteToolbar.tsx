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
} from "@/design/components";
import { formatShortcut } from "@/app/shortcuts";
import { useRepoBusy } from "@/features/ops/store";
import { useOplogState, useRefs, useStatus } from "@/ipc/queries";
import type { PullStrategy } from "@/ipc/bindings";
import { updateSettings, useSettings } from "@/stores/settings";
import { useRemotesUi } from "@/stores/remotes";
import { useRepoStore } from "@/stores/repo";
import { usePlatform } from "@/app/platform";
import { fetchRemote, headBranch, pullCurrent, pushBranch, STRATEGY_LABEL } from "./actions";
import { promptBranchAtHead, requestOplogStep } from "./oplogActions";

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
  const platform = usePlatform();

  const branch = headBranch(refs.data);
  const canPull = !busy && !!branch?.upstream;
  const canPush = !busy && !!branch;
  // HEAD must be known and born: an unborn HEAD has no commit to branch from.
  const canCreateBranch = !busy && !!refs.data && refs.data.head.kind !== "unborn";
  const changes = status.data
    ? status.data.staged.length + status.data.unstaged.length + status.data.conflicted.length
    : 0;
  const canStash = !busy && changes > 0;
  const undoTip = oplogState.data?.undoDescription
    ? `Undo: ${oplogState.data.undoDescription}`
    : oplogState.data?.canUndo
      ? "Undo last operation"
      : "Nothing to undo";
  const redoLabel = oplogState.data?.redoDescription
    ? `Redo: ${oplogState.data.redoDescription}`
    : "Redo";

  const handleStash = () => {
    useRepoStore.getState().setStashDialog(repoId, true);
  };

  return (
    <div
      role="toolbar"
      aria-label="Remote operations"
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-toolbar px-3"
    >
      {/* Undo/Redo split button (read-write only) */}
      {!platform.readOnly && (
        <div className="flex items-center gap-px">
          <Tooltip content={undoTip} shortcut={formatShortcut("mod+z")}>
            <Button
              disabled={!oplogState.data?.canUndo || busy}
              className="rounded-r-none"
              onClick={() => void requestOplogStep(client, repoId, "undo")}
            >
              <Undo2 />
              Undo
            </Button>
          </Tooltip>
          <DropdownMenu>
            <Tooltip content="Redo">
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="Undo options"
                  variant="secondary"
                  disabled={busy}
                  className="w-6 rounded-l-none"
                >
                  <ChevronDown />
                </IconButton>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={!oplogState.data?.canRedo}
                icon={<Redo2 />}
                shortcut={formatShortcut("mod+shift+z")}
                onSelect={() => void requestOplogStep(client, repoId, "redo")}
              >
                {redoLabel}
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
              void pullCurrent(client, repoId, platform.readOnly ? "ffOnly" : strategy)
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
            <Button
              disabled={!canCreateBranch}
              onClick={() => promptBranchAtHead(repoId, refs.data)}
            >
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
