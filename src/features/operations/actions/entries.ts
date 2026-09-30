import {
  Cherry,
  Copy,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  ListOrdered,
  LogIn,
  Pencil,
  RotateCcw,
  Tag,
  Trash2,
  Undo2,
} from "lucide-react";
import type { HeadState, ResetMode } from "@/ipc/bindings";
import { ops } from "./ops";
import type { ActionEntry, ActionTarget, OperationSpec, PromptRequest } from "./types";

/** What menu entries need to act: the repo, its HEAD and the side effects to trigger. */
export interface ActionContext {
  repoId: string;
  head: HeadState | null;
  perform: (spec: OperationSpec) => void;
  prompt: (request: PromptRequest) => void;
  copy: (text: string) => void;
  openRebaseEditor: (base: string) => void;
}

type Item = Extract<ActionEntry, { kind: "item" }>;
const sep: ActionEntry = { kind: "separator" };
const RESET_MODES: ResetMode[] = ["soft", "mixed", "hard"];

export function currentBranchName(head: HeadState | null): string | null {
  return head?.kind === "branch" || head?.kind === "unborn" ? head.name : null;
}

function localNameOf(remoteBranch: string): string {
  const slash = remoteBranch.indexOf("/");
  return slash >= 0 ? remoteBranch.slice(slash + 1) : remoteBranch;
}

function commitEntries(t: Extract<ActionTarget, { kind: "commit" }>, c: ActionContext) {
  const cur = currentBranchName(c.head) ?? "HEAD";
  const entries: ActionEntry[] = [
    {
      kind: "item",
      id: "checkout",
      label: "Checkout commit",
      paletteTitle: `Checkout commit ${t.shortOid}`,
      palette: true,
      icon: LogIn,
      run: () => c.perform(ops.checkout(c.repoId, { kind: "commit", oid: t.oid }, t.shortOid)),
    },
    {
      kind: "item",
      id: "createBranch",
      label: "Create branch here…",
      paletteTitle: `Create branch at ${t.shortOid}…`,
      palette: true,
      icon: GitBranchPlus,
      run: () =>
        c.prompt({ kind: "branch", repoId: c.repoId, startPoint: t.oid, label: t.shortOid }),
    },
    {
      kind: "item",
      id: "createTag",
      label: "Create tag here…",
      paletteTitle: `Create tag at ${t.shortOid}…`,
      palette: true,
      icon: Tag,
      run: () => c.prompt({ kind: "tag", repoId: c.repoId, target: t.oid, label: t.shortOid }),
    },
    sep,
    {
      kind: "item",
      id: "merge",
      label: `Merge into ${cur}`,
      paletteTitle: `Merge ${t.shortOid} into ${cur}`,
      palette: true,
      icon: GitMerge,
      run: () => c.perform(ops.merge(c.repoId, { source: t.oid, into: null, strategy: "auto" })),
    },
    {
      kind: "item",
      id: "rebase",
      label: `Rebase ${cur} onto this`,
      paletteTitle: `Rebase ${cur} onto ${t.shortOid}`,
      palette: true,
      icon: GitBranch,
      destructive: true,
      run: () => c.perform(ops.rebase(c.repoId, { onto: t.oid, branch: null })),
    },
    {
      kind: "item",
      id: "cherryPick",
      label: `Cherry-pick onto ${cur}`,
      paletteTitle: `Cherry-pick ${t.shortOid} onto ${cur}`,
      palette: true,
      icon: Cherry,
      run: () => c.perform(ops.cherryPick(c.repoId, { oid: t.oid, targetBranch: null })),
    },
    {
      kind: "item",
      id: "revert",
      label: "Revert commit",
      paletteTitle: `Revert commit ${t.shortOid}`,
      palette: true,
      icon: Undo2,
      run: () => c.perform(ops.revert(c.repoId, t.oid)),
    },
    sep,
    { kind: "label", label: `Reset ${cur} to here` },
    ...RESET_MODES.map((mode): Item => ({
      kind: "item",
      id: `reset.${mode}`,
      label: `Reset ${cur} to here (${mode})`,
      paletteTitle: `Reset ${cur} to ${t.shortOid} (${mode})`,
      palette: true,
      icon: RotateCcw,
      destructive: mode === "hard",
      run: () => c.perform(ops.reset(c.repoId, { target: t.oid, mode })),
    })),
    sep,
    {
      kind: "item",
      id: "interactiveRebase",
      label: "Interactive rebase from here…",
      paletteTitle: `Interactive rebase from ${t.shortOid}…`,
      palette: true,
      icon: ListOrdered,
      run: () => c.openRebaseEditor(t.oid),
    },
    {
      kind: "item",
      id: "copySha",
      label: "Copy SHA",
      paletteTitle: `Copy SHA of ${t.shortOid}`,
      palette: true,
      icon: Copy,
      run: () => c.copy(t.oid),
    },
  ];
  return entries;
}

function branchEntries(t: Extract<ActionTarget, { kind: "branch" }>, c: ActionContext) {
  const cur = currentBranchName(c.head) ?? "HEAD";
  const entries: ActionEntry[] = [];
  if (!t.isHead) {
    entries.push({
      kind: "item",
      id: "checkout",
      label: "Checkout",
      paletteTitle: `Checkout ${t.name}`,
      palette: true,
      icon: LogIn,
      run: () =>
        c.perform(
          ops.checkout(
            c.repoId,
            t.remote
              ? { kind: "remoteBranch", name: t.name, localName: localNameOf(t.name) }
              : { kind: "branch", name: t.name },
            t.name,
          ),
        ),
    });
  }
  entries.push({
    kind: "item",
    id: "createBranch",
    label: "Create branch here…",
    paletteTitle: `Create branch at ${t.name}…`,
    icon: GitBranchPlus,
    run: () => c.prompt({ kind: "branch", repoId: c.repoId, startPoint: t.oid, label: t.name }),
  });
  if (!t.isHead) {
    entries.push(
      sep,
      {
        kind: "item",
        id: "merge",
        label: `Merge into ${cur}`,
        paletteTitle: `Merge ${t.name} into ${cur}`,
        palette: true,
        icon: GitMerge,
        run: () => c.perform(ops.merge(c.repoId, { source: t.name, into: null, strategy: "auto" })),
      },
      {
        kind: "item",
        id: "rebase",
        label: `Rebase ${cur} onto this`,
        paletteTitle: `Rebase ${cur} onto ${t.name}`,
        palette: true,
        icon: GitBranch,
        destructive: true,
        run: () => c.perform(ops.rebase(c.repoId, { onto: t.name, branch: null })),
      },
    );
  }
  entries.push(sep);
  if (!t.remote) {
    entries.push({
      kind: "item",
      id: "rename",
      label: "Rename branch…",
      icon: Pencil,
      run: () => c.prompt({ kind: "rename", repoId: c.repoId, oldName: t.name }),
    });
  }
  if (!t.isHead) {
    entries.push({
      kind: "item",
      id: "delete",
      label: "Delete branch",
      icon: Trash2,
      destructive: true,
      run: () => c.perform(ops.branchDelete(c.repoId, { name: t.name, remote: t.remote })),
    });
  }
  entries.push({
    kind: "item",
    id: "copyName",
    label: "Copy branch name",
    icon: Copy,
    run: () => c.copy(t.name),
  });
  return entries;
}

function tagEntries(t: Extract<ActionTarget, { kind: "tag" }>, c: ActionContext) {
  const entries: ActionEntry[] = [
    {
      kind: "item",
      id: "checkout",
      label: "Checkout",
      paletteTitle: `Checkout tag ${t.name}`,
      icon: LogIn,
      run: () => c.perform(ops.checkout(c.repoId, { kind: "commit", oid: t.oid }, t.name)),
    },
    {
      kind: "item",
      id: "createBranch",
      label: "Create branch here…",
      icon: GitBranchPlus,
      run: () => c.prompt({ kind: "branch", repoId: c.repoId, startPoint: t.oid, label: t.name }),
    },
    sep,
    {
      kind: "item",
      id: "deleteTag",
      label: "Delete tag",
      icon: Trash2,
      destructive: true,
      run: () => c.perform(ops.tagDelete(c.repoId, t.name)),
    },
    {
      kind: "item",
      id: "copyName",
      label: "Copy tag name",
      icon: Copy,
      run: () => c.copy(t.name),
    },
  ];
  return entries;
}

/** The context menu (and palette) actions for a commit, branch or tag. */
export function buildActionEntries(target: ActionTarget, ctx: ActionContext): ActionEntry[] {
  switch (target.kind) {
    case "commit":
      return commitEntries(target, ctx);
    case "branch":
      return branchEntries(target, ctx);
    case "tag":
      return tagEntries(target, ctx);
  }
}
