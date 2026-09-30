import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUp, GitBranch, Trash2, Undo2 } from "lucide-react";
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
import { useRefs } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { Item, Section } from "./SidebarParts";

export function RefsSidebar({ repoId }: { repoId: string }) {
  const refs = useRefs(repoId);
  const select = useRepoStore((s) => s.selectCommit);
  const stash = useStashActions(repoId);
  const client = useQueryClient();
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
                    onClick={() => select(repoId, b.oid)}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    icon={<ArrowUp />}
                    onSelect={() => void pushBranch(client, repoId, { branch: b.name })}
                  >
                    Push
                  </ContextMenuItem>
                  <ContextMenuItem icon={<GitBranch />} onSelect={() => setUpstreamFor(b)}>
                    Set upstream…
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </Section>
          <RemotesSection repoId={repoId} branches={data.remote} />
          <Section title="Tags" count={data.tags.length}>
            {data.tags.map((t) => (
              <Item key={t.name} label={t.name} onClick={() => select(repoId, t.oid)} />
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
      {stash.dialog}
      <SetUpstreamDialog
        repoId={repoId}
        branch={upstreamFor}
        remoteBranches={data?.remote ?? []}
        onClose={() => setUpstreamFor(null)}
      />
    </nav>
  );
}
