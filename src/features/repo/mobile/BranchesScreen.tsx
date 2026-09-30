import { useState, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Copy,
  EllipsisVertical,
  FileText,
  GitBranch,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { TabScreenProps } from "@/app/layout/registry";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import { usePlatform } from "@/app/platform";
import {
  ActionSheet,
  AlertDialog,
  Button,
  IconButton,
  ListRow,
  PullToRefresh,
  SegmentedControl,
  toast,
} from "@/design/components";
import { openPrDescription } from "@/features/ai";
import { baseFor, useBranchSummary } from "@/features/history-views/useBranchSummary";
import { branchActionTarget } from "@/features/operations/dnd/refs";
import { buildActionEntries } from "@/features/operations/actions/entries";
import type { ActionEntry } from "@/features/operations/actions/types";
import { useActionContext } from "@/features/operations/actions/useActionContext";
import { fetchRemote, pushBranch } from "@/features/remotes/actions";
import { RemoteFormDialog, type RemoteFormMode } from "@/features/remotes/RemoteFormDialog";
import { SetUpstreamDialog } from "@/features/remotes/SetUpstreamDialog";
import { commands, type BranchInfo, type RemoteInfo } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateAfterOp, useAiEnabled, useRefs, useRemotes } from "@/ipc/queries";
import { useDndStore } from "@/stores/dnd";
import { useNav } from "@/stores/nav";
import { useRemotesUi } from "@/stores/remotes";
import { RefRow } from "./RefRow";

type Page = "local" | "remote" | "tags";

const item = (
  id: string,
  label: string,
  icon: ComponentType<{ className?: string }>,
  run: () => void,
): ActionEntry => ({ kind: "item", id, label, icon, run });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const remoteOf = (b: BranchInfo, remotes: RemoteInfo[]) =>
  b.remote ??
  [...remotes]
    .sort((a, c) => c.name.length - a.name.length)
    .find((r) => b.name.startsWith(`${r.name}/`))?.name ??
  b.name.split("/")[0] ??
  "";

/** Phone Branches tab: Local / Remotes / Tags pages with ref action sheets. */
export function BranchesScreen({ repoId }: TabScreenProps) {
  usePlatform();
  const nav = useNav();
  const client = useQueryClient();
  const refs = useRefs(repoId);
  const remotes = useRemotes(repoId);
  const makeContext = useActionContext(repoId);
  const aiEnabled = useAiEnabled();
  const summary = useBranchSummary(repoId);
  const setAddRemoteFor = useRemotesUi((s) => s.setAddRemoteFor);
  const [page, setPage] = useState<Page>("local");
  const [search, setSearch] = useState("");
  const [upstreamFor, setUpstreamFor] = useState<BranchInfo | null>(null);
  const [remoteSheet, setRemoteSheet] = useState<RemoteInfo | null>(null);
  const [form, setForm] = useState<RemoteFormMode | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const data = refs.data;
  const q = search.trim().toLowerCase();
  const match = (name: string) => q === "" || name.toLowerCase().includes(q);

  const openMenu = (title: string, entries: ActionEntry[]) =>
    useDndStore.getState().openMenu({ x: 0, y: 0, title, entries });

  const localMenu = (b: BranchInfo) => {
    const extras: ActionEntry[] = [
      { kind: "separator" },
      item("push", "Push", ArrowUp, () => void pushBranch(client, repoId, { branch: b.name })),
      item("setUpstream", "Set upstream…", GitBranch, () => setUpstreamFor(b)),
      item("reflog", "Show reflog", History, () => nav.push({ name: "reflog", ref: b.fullName })),
    ];
    if (aiEnabled) {
      extras.push(
        item(
          "summarize",
          "Summarize branch",
          Sparkles,
          () => void summary.summarize(b.name, baseFor(b.upstream)),
        ),
        item("prDescription", "Draft PR description", FileText, () =>
          openPrDescription({ repoId, base: baseFor(b.upstream), head: b.name }),
        ),
      );
    }
    openMenu(b.name, [
      ...buildActionEntries(branchActionTarget(b, false), makeContext()),
      ...extras,
    ]);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("URL copied");
    } catch {
      toast.error("Could not copy the URL");
    }
  };

  const removeRemote = async (name: string) => {
    try {
      await unwrap(commands.remoteRemove(repoId, name));
      toast.success(`Remote ${name} removed`);
    } catch (e) {
      toast.error(`Could not remove ${name}: ${message(e)}`);
    } finally {
      void invalidateAfterOp(client, repoId);
    }
  };

  const newBranch = () => {
    const head = data?.local.find((b) => b.isHead) ?? data?.local[0];
    useDndStore.getState().setPrompt({
      kind: "branch",
      repoId,
      startPoint: head?.oid ?? "HEAD",
      label: head?.name ?? "HEAD",
    });
  };

  const empty = <p className="p-4 text-sm text-fg-muted">Nothing here.</p>;
  const local = (data?.local ?? []).filter((b) => match(b.name));
  const remoteBranches = (data?.remote ?? []).filter((b) => match(b.name));
  const tags = (data?.tags ?? []).filter((t) => match(t.name));

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <ShellAppBar
        repoId={repoId}
        actions={
          <>
            <IconButton aria-label="New branch" onClick={newBranch}>
              <Plus />
            </IconButton>
            <IconButton aria-label="Fetch" onClick={() => void fetchRemote(repoId, null)}>
              <RefreshCw />
            </IconButton>
          </>
        }
      >
        <div className="flex flex-col gap-2 px-3 pb-2">
          <SegmentedControl<Page>
            aria-label="Reference type"
            value={page}
            onValueChange={setPage}
            options={[
              { value: "local", label: "Local" },
              { value: "remote", label: "Remotes" },
              { value: "tags", label: "Tags" },
            ]}
          />
          <input
            type="search"
            aria-label="Search references"
            placeholder="Search references"
            autoCapitalize="none"
            autoCorrect="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-[var(--touch-target)] rounded-md border border-border bg-bg-subtle px-3 text-base text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
      </ShellAppBar>
      <PullToRefresh
        label="Fetching"
        onRefresh={() => fetchRemote(repoId, null)}
        className="min-h-0 flex-1"
      >
        <nav aria-label="References" data-scroll-root="" className="pb-4">
          {refs.isError && <p className="p-3 text-sm text-danger">{refs.error.message}</p>}
          {data && page === "local" && (
            <ul aria-label="Local branches">
              {local.length === 0 && empty}
              {local.map((b) => (
                <li key={b.fullName}>
                  <RefRow
                    label={b.name}
                    active={b.isHead}
                    hint={b.ahead || b.behind ? `↑${b.ahead} ↓${b.behind}` : undefined}
                    subtitle={b.upstream ?? undefined}
                    actionsLabel={`Actions for ${b.name}`}
                    onOpen={() => localMenu(b)}
                  />
                </li>
              ))}
            </ul>
          )}
          {data && page === "remote" && (
            <div aria-label="Remotes">
              {(remotes.data ?? []).map((r) => {
                const list = remoteBranches.filter(
                  (b) => remoteOf(b, remotes.data ?? []) === r.name,
                );
                return (
                  <section key={r.name} aria-label={`Remote ${r.name}`}>
                    <ListRow
                      className="bg-bg-subtle"
                      title={<span className="font-semibold">{r.name}</span>}
                      subtitle={r.fetchUrl}
                      trailing={
                        <IconButton
                          aria-label={`Actions for remote ${r.name}`}
                          onClick={() => setRemoteSheet(r)}
                        >
                          <EllipsisVertical />
                        </IconButton>
                      }
                    />
                    <ul>
                      {list.map((b) => (
                        <li key={b.fullName}>
                          <RefRow
                            label={b.name}
                            actionsLabel={`Actions for ${b.name}`}
                            onOpen={() =>
                              openMenu(
                                b.name,
                                buildActionEntries(branchActionTarget(b, true), makeContext()),
                              )
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              <div className="p-3">
                <Button variant="outline" onClick={() => setAddRemoteFor(repoId)}>
                  <Plus />
                  Add remote
                </Button>
              </div>
            </div>
          )}
          {data && page === "tags" && (
            <ul aria-label="Tags">
              {tags.length === 0 && empty}
              {tags.map((t) => (
                <li key={t.name}>
                  <RefRow
                    label={t.name}
                    actionsLabel={`Actions for ${t.name}`}
                    onOpen={() =>
                      openMenu(
                        t.name,
                        buildActionEntries(
                          { kind: "tag", name: t.name, oid: t.oid },
                          makeContext(),
                        ),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </nav>
      </PullToRefresh>
      <ActionSheet
        open={remoteSheet !== null}
        onOpenChange={(o) => !o && setRemoteSheet(null)}
        title={remoteSheet?.name ?? ""}
        items={
          remoteSheet
            ? [
                {
                  id: "fetch",
                  label: "Fetch",
                  icon: <RefreshCw />,
                  onSelect: () => void fetchRemote(repoId, remoteSheet.name),
                },
                {
                  id: "editUrl",
                  label: "Edit URL",
                  icon: <Pencil />,
                  onSelect: () =>
                    setForm({ kind: "url", name: remoteSheet.name, url: remoteSheet.fetchUrl }),
                },
                {
                  id: "rename",
                  label: "Rename",
                  icon: <Pencil />,
                  onSelect: () => setForm({ kind: "rename", name: remoteSheet.name }),
                },
                {
                  id: "copyUrl",
                  label: "Copy URL",
                  icon: <Copy />,
                  onSelect: () => void copy(remoteSheet.fetchUrl),
                },
                {
                  id: "remove",
                  label: "Remove",
                  icon: <Trash2 />,
                  destructive: true,
                  onSelect: () => setRemoving(remoteSheet.name),
                },
              ]
            : []
        }
      />
      <RemoteFormDialog repoId={repoId} mode={form} onClose={() => setForm(null)} />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove remote ${removing ?? ""}?`}
        description="Its remote-tracking branches are removed from this repository. The remote itself is not touched."
        confirmLabel="Remove"
        destructive
        onConfirm={() => removing && void removeRemote(removing)}
      />
      <SetUpstreamDialog
        repoId={repoId}
        branch={upstreamFor}
        remoteBranches={data?.remote ?? []}
        onClose={() => setUpstreamFor(null)}
      />
      {summary.dialog}
    </div>
  );
}
