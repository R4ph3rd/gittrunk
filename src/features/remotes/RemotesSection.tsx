import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  GitBranchPlus,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  toast,
} from "@/design/components";
import { useOutcomeToast } from "@/features/staging/ops";
import { commands, type BranchInfo, type OpPreview, type RemoteInfo } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateAfterOp, useRemotes } from "@/ipc/queries";
import { useRemotesUi } from "@/stores/remotes";
import { useRepoStore } from "@/stores/repo";
import { Item, Section } from "@/features/repo/SidebarParts";
import { fetchRemote } from "./actions";
import { RemoteFormDialog, type RemoteFormMode } from "./RemoteFormDialog";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface RemoteGroup {
  remote: RemoteInfo;
  branches: BranchInfo[];
}

function groupRemotes(remotes: RemoteInfo[], branches: BranchInfo[]): RemoteGroup[] {
  const names = remotes.map((r) => r.name).sort((a, b) => b.length - a.length);
  const remoteOf = (b: BranchInfo) =>
    b.remote ?? names.find((n) => b.name.startsWith(`${n}/`)) ?? b.name.split("/")[0] ?? "";
  const groups = remotes.map((remote) => ({
    remote,
    branches: branches.filter((b) => remoteOf(b) === remote.name),
  }));
  return groups;
}

/** The short branch name on the remote: `origin/feature/x` becomes `feature/x`. */
const localNameOf = (b: BranchInfo, remote: string) =>
  b.name.startsWith(`${remote}/`) ? b.name.slice(remote.length + 1) : b.name;

/** Remotes with their branches nested underneath, plus remote and remote-branch menus. */
export function RemotesSection({ repoId, branches }: { repoId: string; branches: BranchInfo[] }) {
  const client = useQueryClient();
  const remotes = useRemotes(repoId);
  const select = useRepoStore((s) => s.selectCommit);
  const setAddRemoteFor = useRemotesUi((s) => s.setAddRemoteFor);
  const notify = useOutcomeToast(repoId);
  const [form, setForm] = useState<RemoteFormMode | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{
    branch: BranchInfo;
    remote: string;
    preview: OpPreview;
  } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const groups = groupRemotes(remotes.data ?? [], branches);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL copied");
    } catch {
      toast.error("Could not copy the URL");
    }
  };

  const remove = async (name: string) => {
    try {
      await unwrap(commands.remoteRemove(repoId, name));
      toast.success(`Remote ${name} removed`);
    } catch (e) {
      toast.error(`Could not remove ${name}: ${message(e)}`);
    } finally {
      void invalidateAfterOp(client, repoId);
    }
  };

  const checkout = async (b: BranchInfo, remote: string) => {
    try {
      const outcome = await unwrap(
        commands.checkout(
          repoId,
          { kind: "remoteBranch", name: b.name, localName: localNameOf(b, remote) },
          false,
        ),
      );
      notify(outcome, `Checked out ${localNameOf(b, remote)}`);
    } catch (e) {
      toast.error(`Could not check out ${b.name}: ${message(e)}`);
    } finally {
      void invalidateAfterOp(client, repoId);
    }
  };

  const requestDelete = async (b: BranchInfo, remote: string) => {
    try {
      const outcome = await unwrap(
        commands.branchDelete(repoId, { name: b.name, remote: true, force: false }, true),
      );
      if (outcome.kind === "preview") setDeleting({ branch: b, remote, preview: outcome.preview });
      else notify(outcome, `Deleted ${b.name}`);
    } catch (e) {
      toast.error(`Could not prepare delete: ${message(e)}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      const outcome = await unwrap(
        commands.branchDelete(
          repoId,
          { name: deleting.branch.name, remote: true, force: false },
          false,
        ),
      );
      notify(outcome, `Deleted ${deleting.branch.name}`);
    } catch (e) {
      toast.error(`Could not delete ${deleting.branch.name}: ${message(e)}`);
    } finally {
      void invalidateAfterOp(client, repoId);
    }
  };

  return (
    <>
      <Section title="Remotes" count={groups.length}>
        {groups.map(({ remote, branches: list }) => {
          const expanded = open[remote.name] ?? true;
          const Chevron = expanded ? ChevronDown : ChevronRight;
          return (
            <li key={remote.name}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`Remote ${remote.name}`}
                    onClick={() => setOpen({ ...open, [remote.name]: !expanded })}
                    className="flex h-6 w-full items-center gap-1 pl-4 pr-2 text-left text-sm text-fg hover:bg-surface-hover"
                  >
                    <Chevron className="size-3 shrink-0 text-fg-subtle" aria-hidden />
                    <span className="truncate">{remote.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-fg-subtle">
                      {list.length}
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    icon={<RefreshCw />}
                    onSelect={() => void fetchRemote(repoId, remote.name)}
                  >
                    Fetch
                  </ContextMenuItem>
                  <ContextMenuItem
                    icon={<Pencil />}
                    onSelect={() =>
                      setForm({ kind: "url", name: remote.name, url: remote.fetchUrl })
                    }
                  >
                    Edit URL
                  </ContextMenuItem>
                  <ContextMenuItem
                    icon={<Pencil />}
                    onSelect={() => setForm({ kind: "rename", name: remote.name })}
                  >
                    Rename
                  </ContextMenuItem>
                  <ContextMenuItem icon={<Copy />} onSelect={() => void copy(remote.fetchUrl)}>
                    Copy URL
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    icon={<Trash2 />}
                    destructive
                    onSelect={() => setRemoving(remote.name)}
                  >
                    Remove
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {expanded && (
                <ul>
                  {list.map((b) => (
                    <ContextMenu key={b.fullName}>
                      <ContextMenuTrigger asChild>
                        <Item
                          nested
                          label={localNameOf(b, remote.name)}
                          onClick={() => select(repoId, b.oid)}
                        />
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          icon={<GitBranchPlus />}
                          onSelect={() => void checkout(b, remote.name)}
                        >
                          Checkout as local branch
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          icon={<Trash2 />}
                          destructive
                          onSelect={() => void requestDelete(b, remote.name)}
                        >
                          Delete remote branch
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        <li className="px-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => setAddRemoteFor(repoId)}
          >
            <Plus />
            Add remote
          </Button>
        </li>
      </Section>

      <RemoteFormDialog repoId={repoId} mode={form} onClose={() => setForm(null)} />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove remote ${removing ?? ""}?`}
        description="Its remote-tracking branches are removed from this repository. The remote itself is not touched."
        confirmLabel="Remove"
        destructive
        onConfirm={() => removing && void remove(removing)}
      />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete remote branch?"
        description="The branch is deleted on the remote. You can undo right after."
        preview={
          deleting ? (
            <div className="flex flex-col gap-1">
              <span className="text-fg">{deleting.branch.name}</span>
              <span className="whitespace-pre-wrap text-fg-muted">{deleting.preview.summary}</span>
              {deleting.preview.warnings.map((w) => (
                <span key={w} className="text-warning">
                  {w}
                </span>
              ))}
            </div>
          ) : null
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
