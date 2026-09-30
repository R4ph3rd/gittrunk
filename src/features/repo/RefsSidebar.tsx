import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUp,
  FileText,
  GitBranch,
  History,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
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
import { usePlatform } from "@/app/platform";
import { useRefs } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { TargetEntries } from "@/features/operations/actions/ActionMenu";
import { branchActionTarget, branchDnd, tagDnd } from "@/features/operations/dnd/refs";
import { Item, Section } from "./SidebarParts";

export function RefsSidebar({ repoId }: { repoId: string }) {
  const refs = useRefs(repoId);
  const platform = usePlatform();
  const select = useRepoStore((s) => s.selectCommit);
  const stash = useStashActions(repoId);
  const client = useQueryClient();
  const branchSummary = useBranchSummary(repoId);
  const [upstreamFor, setUpstreamFor] = useState<BranchInfo | null>(null);
  const data = refs.data;

  return (
    <nav aria-label="References" className="h-full overflow-y-auto bg-surface py-1">
      {refs.isError && <p className="p-3 text-sm text-danger">{refs.error.message}</p>}
      {data && (
        <>
          <Section title="Branches" count={data.local.length}>
            {data.local.map((b) => (
              <ContextMenu key={b.fullName}>
                <ContextMenuTrigger asChild>
                  <Item
                    label={b.name}
                    active={b.isHead}
                    hint={b.ahead || b.behind ? `+${b.ahead} -${b.behind}` : undefined}
                    dnd={branchDnd(repoId, b, false)}
                    onClick={() => select(repoId, b.oid)}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <TargetEntries repoId={repoId} target={branchActionTarget(b, false)} />
                  <ContextMenuSeparator />
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
            ))}
          </Section>
          <RemotesSection repoId={repoId} branches={data.remote} />
          <Section title="Tags" count={data.tags.length}>
            {data.tags.map((t) => (
              <ContextMenu key={t.name}>
                <ContextMenuTrigger asChild>
                  <Item
                    label={t.name}
                    dnd={tagDnd(repoId, t)}
                    onClick={() => select(repoId, t.oid)}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <TargetEntries
                    repoId={repoId}
                    target={{ kind: "tag", name: t.name, oid: t.oid }}
                  />
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </Section>
          <Section title="Stashes" count={data.stashes.length}>
            {data.stashes.map((s) => (
              <ContextMenu key={s.index}>
                <ContextMenuTrigger asChild>
                  <Item label={stashLabel(s)} onClick={() => select(repoId, s.oid)} />
                </ContextMenuTrigger>
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
            ))}
          </Section>
        </>
      )}
      {platform.supportsSubmodules && <SubmodulesSection repoId={repoId} />}
      {platform.supportsWorktrees && <WorktreesSection repoId={repoId} />}
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
