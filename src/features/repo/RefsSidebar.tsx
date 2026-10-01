import { Fragment, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUp,
  FileText,
  GitBranch,
  History,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Tooltip,
} from "@/design/components";
import { stashLabel, useStashActions } from "@/features/stash/useStashActions";
import { pushBranch } from "@/features/remotes/actions";
import { RemotesSection } from "@/features/remotes/RemotesSection";
import { SetUpstreamDialog } from "@/features/remotes/SetUpstreamDialog";
import type { BranchInfo } from "@/ipc/bindings";
import { openPrDescription } from "@/features/ai";
import { HistoryViewsHost } from "@/features/history-views/HistoryViewsHost";
import { SubmodulesSection, WorktreesSection } from "@/features/history-views/SidebarSections";
import { openReflog } from "@/features/history-views/store";
import { baseFor, useBranchSummary } from "@/features/history-views/useBranchSummary";
import { IssuesSection } from "@/features/forge/IssuesSection";
import { usePlatform } from "@/app/platform";
import { useRefColors, useRefs } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { TargetEntries } from "@/features/operations/actions/ActionMenu";
import { branchActionTarget, branchDnd, tagDnd } from "@/features/operations/dnd/refs";
import { useDndStore } from "@/stores/dnd";
import { showGraph } from "@/stores/workspace";
import { laneVar } from "@/lib/laneColor";
import { Item, Section } from "./SidebarParts";

export function RefsSidebar({ repoId }: { repoId: string }) {
  const refs = useRefs(repoId);
  const platform = usePlatform();
  const select = useRepoStore((s) => s.selectCommit);
  const stash = useStashActions(repoId);
  const client = useQueryClient();
  const branchSummary = useBranchSummary(repoId);
  const refColors = useRefColors(repoId);
  const [upstreamFor, setUpstreamFor] = useState<BranchInfo | null>(null);
  const data = refs.data;

  const createBranch = () => {
    if (!data || data.head.kind === "unborn") return;
    const headOid = data.head.kind === "branch" ? data.head.oid : data.head.oid;
    const headLabel = data.head.kind === "branch" ? data.head.name : headOid.slice(0, 7);
    useDndStore.getState().setPrompt({
      kind: "branch",
      repoId,
      startPoint: headOid,
      label: headLabel,
    });
  };

  const selectAndShowGraph = (repoId: string, oid: string) => {
    select(repoId, oid);
    showGraph(repoId);
  };

  return (
    <nav aria-label="References" className="h-full overflow-y-auto bg-surface py-1">
      {refs.isError && <p className="p-3 text-sm text-danger">{refs.error.message}</p>}
      {data && (
        <>
          <Section
            title="Local"
            count={data.local.length}
            actions={
              !platform.readOnly && (
                <Tooltip content="Create branch at HEAD" shortcut="Mod+Shift+B">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={data.head.kind === "unborn"}
                    onClick={createBranch}
                    aria-label="Create branch"
                  >
                    <Plus />
                  </Button>
                </Tooltip>
              )
            }
          >
            {data.local.map((b) => {
              const color = refColors.get(b.fullName);
              return (
                <ContextMenu key={b.fullName}>
                  <ContextMenuTrigger asChild>
                    <Item
                      label={b.name}
                      active={b.isHead}
                      hint={b.ahead || b.behind ? `+${b.ahead} -${b.behind}` : undefined}
                      leading={
                        <GitBranch
                          className="size-3.5 shrink-0"
                          aria-hidden
                          style={{
                            color: color !== undefined ? laneVar(color) : "var(--fg-subtle)",
                          }}
                        />
                      }
                      dnd={branchDnd(repoId, b, false)}
                      onClick={() => selectAndShowGraph(repoId, b.oid)}
                    />
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <TargetEntries repoId={repoId} target={branchActionTarget(b, false)} />
                    <ContextMenuSeparator />
                    {!platform.readOnly && (
                      <>
                        <ContextMenuItem
                          icon={<ArrowUp />}
                          onSelect={() => void pushBranch(client, repoId, { branch: b.name })}
                        >
                          Push
                        </ContextMenuItem>
                        <ContextMenuItem icon={<GitBranch />} onSelect={() => setUpstreamFor(b)}>
                          Set upstream…
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                      </>
                    )}
                    <ContextMenuItem
                      icon={<History />}
                      onSelect={() => openReflog(repoId, b.fullName)}
                    >
                      Show reflog
                    </ContextMenuItem>
                    <ContextMenuItem
                      icon={<Sparkles />}
                      onSelect={() => void branchSummary.summarize(b.name, baseFor(b.upstream))}
                    >
                      Summarize branch
                    </ContextMenuItem>
                    <ContextMenuItem
                      icon={<FileText />}
                      onSelect={() =>
                        openPrDescription({ repoId, base: baseFor(b.upstream), head: b.name })
                      }
                    >
                      Draft PR description
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </Section>
          <RemotesSection repoId={repoId} branches={data.remote} />
          <Section title="Tags" count={data.tags.length}>
            {data.tags.map((t) => {
              const color = refColors.get(`refs/tags/${t.name}`);
              return (
                <ContextMenu key={t.name}>
                  <ContextMenuTrigger asChild>
                    <Item
                      label={t.name}
                      leading={
                        <Tag
                          className="size-3.5 shrink-0"
                          aria-hidden
                          style={{
                            color: color !== undefined ? laneVar(color) : "var(--fg-subtle)",
                          }}
                        />
                      }
                      dnd={tagDnd(repoId, t)}
                      onClick={() => selectAndShowGraph(repoId, t.oid)}
                    />
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <TargetEntries
                      repoId={repoId}
                      target={{ kind: "tag", name: t.name, oid: t.oid }}
                    />
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </Section>
          <Section title="Stashes" count={data.stashes.length}>
            {data.stashes.map((s) => {
              const item = (
                <Item
                  label={stashLabel(s)}
                  leading={
                    <div className="size-2.5 shrink-0 rounded-full bg-fg-subtle" aria-hidden />
                  }
                  onClick={() => selectAndShowGraph(repoId, s.oid)}
                />
              );
              // Read-only platforms browse stashes but cannot apply or drop them.
              if (platform.readOnly) return <Fragment key={s.index}>{item}</Fragment>;
              return (
                <ContextMenu key={s.index}>
                  <ContextMenuTrigger asChild>{item}</ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem icon={<Undo2 />} onSelect={() => void stash.apply(s, false)}>
                      Apply
                    </ContextMenuItem>
                    <ContextMenuItem
                      icon={<ArrowDownToLine />}
                      onSelect={() => void stash.apply(s, true)}
                    >
                      Pop
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      icon={<Trash2 />}
                      destructive
                      onSelect={() => void stash.drop(s)}
                    >
                      Drop
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </Section>
        </>
      )}
      {platform.supportsSubmodules && <SubmodulesSection repoId={repoId} />}
      {platform.supportsWorktrees && <WorktreesSection repoId={repoId} />}
      <IssuesSection repoId={repoId} />
      {stash.dialog}
      {branchSummary.dialog}
      <HistoryViewsHost repoId={repoId} />
      <SetUpstreamDialog
        repoId={repoId}
        branch={upstreamFor}
        remoteBranches={data?.remote ?? []}
        onClose={() => setUpstreamFor(null)}
      />
    </nav>
  );
}
