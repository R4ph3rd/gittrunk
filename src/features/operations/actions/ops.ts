import { commands, type MergeStrategy, type ResetMode } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import type { DropAction, DropOption } from "../dnd/types";
import type { OperationSpec } from "./types";

/** Builders for every operation the drag and drop and menu flows can request. */
export const ops = {
  merge(
    repoId: string,
    p: { source: string; into: string | null; strategy: MergeStrategy; label?: string },
  ): OperationSpec {
    const into = p.into ?? "the current branch";
    return {
      repoId,
      title: `${p.label ?? `Merge ${p.source} into ${into}`}?`,
      confirmLabel: "Merge",
      run: (dryRun) =>
        unwrap(
          commands.merge(
            repoId,
            { source: p.source, into: p.into, strategy: p.strategy, message: null },
            dryRun,
          ),
        ),
    };
  },
  rebase(repoId: string, p: { onto: string; branch: string | null }): OperationSpec {
    return {
      repoId,
      title: `Rebase ${p.branch ?? "the current branch"} onto ${p.onto}?`,
      confirmLabel: "Rebase",
      destructive: true,
      run: (dryRun) => unwrap(commands.rebase(repoId, { onto: p.onto, branch: p.branch }, dryRun)),
    };
  },
  cherryPick(repoId: string, p: { oid: string; targetBranch: string | null }): OperationSpec {
    return {
      repoId,
      title: `Cherry-pick ${p.oid.slice(0, 7)} onto ${p.targetBranch ?? "the current branch"}?`,
      confirmLabel: "Cherry-pick",
      run: (dryRun) =>
        unwrap(
          commands.cherryPick(
            repoId,
            { commits: [p.oid], targetBranch: p.targetBranch, noCommit: false },
            dryRun,
          ),
        ),
    };
  },
  revert(repoId: string, oid: string): OperationSpec {
    return {
      repoId,
      title: `Revert ${oid.slice(0, 7)}?`,
      confirmLabel: "Revert",
      run: (dryRun) => unwrap(commands.revert(repoId, { commits: [oid], noCommit: false }, dryRun)),
    };
  },
  reset(repoId: string, p: { target: string; mode: ResetMode }): OperationSpec {
    return {
      repoId,
      title: `Reset the current branch to ${p.target.slice(0, 7)} (${p.mode})?`,
      confirmLabel: p.mode === "hard" ? "Hard reset" : "Reset",
      destructive: p.mode === "hard",
      run: (dryRun) => unwrap(commands.reset(repoId, { target: p.target, mode: p.mode }, dryRun)),
    };
  },
  moveRef(
    repoId: string,
    p: { name: string; target: string; force: boolean; label: string },
  ): OperationSpec {
    return {
      repoId,
      title: `${p.label}?`,
      confirmLabel: "Move",
      destructive: true,
      run: (dryRun) =>
        unwrap(
          commands.refMove(repoId, { name: p.name, target: p.target, force: p.force }, dryRun),
        ),
    };
  },
  checkout(
    repoId: string,
    target: Parameters<typeof commands.checkout>[1],
    label: string,
  ): OperationSpec {
    return {
      repoId,
      title: `Check out ${label}?`,
      confirmLabel: "Checkout",
      confirm: false,
      successMessage: `Checked out ${label}`,
      run: (dryRun) => unwrap(commands.checkout(repoId, target, dryRun)),
    };
  },
  branchCreate(
    repoId: string,
    p: { name: string; startPoint: string; checkout: boolean },
  ): OperationSpec {
    return {
      repoId,
      title: `Create branch ${p.name}?`,
      confirmLabel: "Create branch",
      confirm: false,
      successMessage: `Created branch ${p.name}`,
      run: (dryRun) =>
        unwrap(
          commands.branchCreate(
            repoId,
            { name: p.name, startPoint: p.startPoint, checkout: p.checkout },
            dryRun,
          ),
        ),
    };
  },
  branchRename(repoId: string, oldName: string, newName: string): OperationSpec {
    return {
      repoId,
      title: `Rename ${oldName} to ${newName}?`,
      confirmLabel: "Rename",
      confirm: false,
      successMessage: `Renamed ${oldName} to ${newName}`,
      run: (dryRun) => unwrap(commands.branchRename(repoId, oldName, newName, dryRun)),
    };
  },
  branchDelete(repoId: string, p: { name: string; remote: boolean }): OperationSpec {
    return {
      repoId,
      title: `Delete branch ${p.name}?`,
      confirmLabel: "Delete",
      destructive: true,
      run: (dryRun) =>
        unwrap(
          commands.branchDelete(repoId, { name: p.name, remote: p.remote, force: false }, dryRun),
        ),
    };
  },
  tagCreate(
    repoId: string,
    p: { name: string; target: string; message: string | null },
  ): OperationSpec {
    return {
      repoId,
      title: `Create tag ${p.name}?`,
      confirmLabel: "Create tag",
      confirm: false,
      successMessage: `Created tag ${p.name}`,
      run: (dryRun) =>
        unwrap(
          commands.tagCreate(
            repoId,
            { name: p.name, target: p.target, message: p.message },
            dryRun,
          ),
        ),
    };
  },
  tagDelete(repoId: string, name: string): OperationSpec {
    return {
      repoId,
      title: `Delete tag ${name}?`,
      confirmLabel: "Delete",
      destructive: true,
      run: (dryRun) => unwrap(commands.tagDelete(repoId, name, dryRun)),
    };
  },
};

/** Sends the interactive rebase editor (implemented elsewhere) the commit to rebase from. */
export function openRebaseEditor(repoId: string, base: string): void {
  window.dispatchEvent(
    new CustomEvent("gittrunk:open-rebase-editor", { detail: { repoId, base } }),
  );
}

/** Maps a chosen drop option to the operation it starts; `null` for non-backend actions. */
export function dropOperation(
  repoId: string,
  option: DropOption,
): { spec: OperationSpec } | { dispatch: () => void } {
  const a: DropAction = option.action;
  switch (a.type) {
    case "merge":
      return { spec: ops.merge(repoId, { source: a.source, into: a.into, strategy: a.strategy }) };
    case "rebase":
      return { spec: ops.rebase(repoId, { onto: a.onto, branch: a.branch }) };
    case "cherryPick":
      return { spec: ops.cherryPick(repoId, { oid: a.oid, targetBranch: a.targetBranch }) };
    case "moveRef":
      return {
        spec: ops.moveRef(repoId, {
          name: a.name,
          target: a.target,
          force: a.force,
          label: option.label,
        }),
      };
    case "reset":
      return { spec: ops.reset(repoId, { target: a.target, mode: a.mode }) };
    case "interactiveRebase":
      return { dispatch: () => openRebaseEditor(repoId, a.base) };
  }
}
