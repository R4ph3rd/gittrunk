import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, FolderPlus, RefreshCw, Trash2, Download, Layers } from "lucide-react";
import {
  Badge,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/design/components";
import { Item, Section } from "@/features/repo/SidebarParts";
import { type SubmoduleInfo, type SubmoduleStatus } from "@/ipc/bindings";
import { useRepoStore } from "@/stores/repo";
import { openAsRepository, joinPath } from "./openRepo";
import { useSubmodules, useWorktrees } from "./queries";
import { updateSubmodules } from "./submoduleOps";
import { RemoveWorktreeDialog } from "./RemoveWorktreeDialog";
import { useHistoryViews } from "./store";
import type { WorktreeInfo } from "@/ipc/bindings";

const STATUS: Record<
  SubmoduleStatus,
  { label: string; variant: "neutral" | "success" | "warning" | "danger" }
> = {
  uninitialized: { label: "Uninitialized", variant: "neutral" },
  upToDate: { label: "Up to date", variant: "success" },
  modified: { label: "Modified", variant: "warning" },
  outOfDate: { label: "Out of date", variant: "danger" },
};

function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function SubmodulesSection({ repoId }: { repoId: string }) {
  const submodules = useSubmodules(repoId);
  const client = useQueryClient();
  const repoPath = useRepoStore((s) => s.repos.find((r) => r.id === repoId)?.path ?? "");
  if (!submodules.data || submodules.data.length === 0) return null;

  const run = (s: SubmoduleInfo, init: boolean, recursive: boolean) =>
    void updateSubmodules(client, repoId, { paths: [s.path], init, recursive }, s.name);

  return (
    <Section title="Submodules" count={submodules.data.length}>
      {submodules.data.map((s) => {
        const status = STATUS[s.status];
        return (
          <ContextMenu key={s.path}>
            <ContextMenuTrigger asChild>
              <Item
                label={s.name}
                title={s.path}
                badges={<Badge variant={status.variant}>{status.label}</Badge>}
                hint={s.path !== s.name ? s.path : undefined}
                onClick={() => {
                  if (s.status !== "uninitialized") {
                    void openAsRepository(joinPath(repoPath, s.path));
                  }
                }}
              />
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem icon={<RefreshCw />} onSelect={() => run(s, false, false)}>
                Update
              </ContextMenuItem>
              <ContextMenuItem icon={<Download />} onSelect={() => run(s, true, false)}>
                Init & update
              </ContextMenuItem>
              <ContextMenuItem icon={<Layers />} onSelect={() => run(s, true, true)}>
                Update recursively
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                icon={<FolderOpen />}
                disabled={s.status === "uninitialized"}
                onSelect={() => void openAsRepository(joinPath(repoPath, s.path))}
              >
                Open as repository
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </Section>
  );
}

export function WorktreesSection({ repoId }: { repoId: string }) {
  const worktrees = useWorktrees(repoId);
  const openAdd = useHistoryViews((s) => s.openAddWorktree);
  const [removing, setRemoving] = useState<WorktreeInfo | null>(null);
  if (!worktrees.data) return null;

  return (
    <>
      <Section title="Worktrees" count={worktrees.data.length}>
        {worktrees.data.map((w) => (
          <ContextMenu key={w.path}>
            <ContextMenuTrigger asChild>
              <Item
                label={basename(w.path)}
                title={w.path}
                hint={w.branch ?? (w.head ? w.head.slice(0, 7) : undefined)}
                badges={
                  <>
                    {w.isMain && <Badge variant="accent">main</Badge>}
                    {w.locked && <Badge variant="warning">locked</Badge>}
                    {w.prunable && <Badge variant="danger">prunable</Badge>}
                  </>
                }
                onClick={() => {
                  if (!w.isMain) void openAsRepository(w.path);
                }}
              />
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                icon={<FolderOpen />}
                disabled={w.prunable}
                onSelect={() => void openAsRepository(w.path)}
              >
                Open as repository
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                icon={<Trash2 />}
                destructive
                disabled={w.isMain}
                onSelect={() => setRemoving(w)}
              >
                Remove…
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        <Item
          label="Add worktree…"
          onClick={() => openAdd(repoId)}
          badges={<FolderPlus className="size-3 text-fg-subtle" />}
        />
      </Section>
      <RemoveWorktreeDialog repoId={repoId} worktree={removing} onClose={() => setRemoving(null)} />
    </>
  );
}
