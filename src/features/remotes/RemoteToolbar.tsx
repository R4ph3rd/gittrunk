import { ArrowDown, ArrowUp, Check, ChevronDown, RefreshCw, TriangleAlert } from "lucide-react";
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
import { useRefs } from "@/ipc/queries";
import type { PullStrategy } from "@/ipc/bindings";
import { updateSettings, useSettings } from "@/stores/settings";
import { useRemotesUi } from "@/stores/remotes";
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
  const busy = useRepoBusy(repoId);
  const strategy = useSettings().pullStrategy;
  const setForcePushFor = useRemotesUi((s) => s.setForcePushFor);

  const branch = headBranch(refs.data);
  const canPull = !busy && !!branch?.upstream;
  const canPush = !busy && !!branch;

  return (
    <div
      role="toolbar"
      aria-label="Remote operations"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3"
    >
      <Tooltip content="Fetch all remotes and prune" shortcut={formatShortcut("mod+alt+f")}>
        <Button disabled={busy} onClick={() => void fetchRemote(repoId, null)}>
          <RefreshCw />
          Fetch
        </Button>
      </Tooltip>

      <div className="flex items-center gap-px">
        <Tooltip
          content={branch?.upstream ? `Pull ${branch.upstream}` : "No upstream branch to pull"}
          shortcut={formatShortcut("mod+shift+l")}
        >
          <Button
            disabled={!canPull}
            className="rounded-r-none"
            onClick={() => void pullCurrent(client, repoId, strategy)}
          >
            <ArrowDown />
            Pull
            <Count n={branch?.behind ?? 0} label="behind" />
          </Button>
        </Tooltip>
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
      </div>

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
    </div>
  );
}
