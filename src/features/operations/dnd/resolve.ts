import type { MergeStrategy } from "@/ipc/bindings";
import type { DragSource, DropContext, DropOption, DropTarget } from "./types";

type BranchSource = Extract<DragSource, { kind: "branch" }>;
type BranchTarget = Extract<DropTarget, { kind: "branch" }>;

function branchOntoBranch(src: BranchSource, dst: BranchTarget): DropOption[] {
  if (dst.remote || dst.fullName === src.fullName) return [];
  const into = dst.isHead ? null : dst.name;
  const merge = (strategy: MergeStrategy, suffix = ""): DropOption => ({
    id: `merge:${strategy}`,
    label: `Merge ${src.name} into ${dst.name}${suffix}`,
    action: { type: "merge", source: src.name, into, strategy },
  });
  const options = [
    merge("auto"),
    merge("noFf", " (no fast-forward)"),
    merge("ffOnly", " (fast-forward only)"),
    merge("squash", " (squash)"),
  ];
  if (!src.remote) {
    options.push({
      id: "rebase",
      label: `Rebase ${src.name} onto ${dst.name}`,
      destructive: true,
      action: { type: "rebase", onto: dst.name, branch: src.name },
    });
  }
  return options;
}

function moveRefTo(
  src: BranchSource | Extract<DragSource, { kind: "tag" }>,
  dst: Extract<DropTarget, { kind: "commit" }>,
): DropOption[] {
  if (src.kind === "branch" && src.remote) return [];
  if (src.oid === dst.oid) return [];
  if (src.kind === "branch" && src.isHead) {
    const reset = (mode: "soft" | "mixed" | "hard"): DropOption => ({
      id: `reset:${mode}`,
      label: `Reset ${src.name} to ${dst.shortOid} (${mode})`,
      destructive: mode === "hard",
      action: { type: "reset", target: dst.oid, mode },
    });
    return [reset("soft"), reset("mixed"), reset("hard")];
  }
  return [
    {
      id: "move",
      label: `Move ${src.name} here`,
      destructive: true,
      action: { type: "moveRef", name: src.fullName, target: dst.oid, force: true },
    },
  ];
}

/**
 * The drop table: which operations a drop offers for a source/target pair. An empty list means the
 * drop is invalid (the target is dimmed and the drop does nothing).
 */
export function resolveDrop(src: DragSource, dst: DropTarget, ctx: DropContext): DropOption[] {
  if (src.kind === "branch" && dst.kind === "branch") return branchOntoBranch(src, dst);
  if (src.kind === "commit" && dst.kind === "branch") {
    if (dst.remote) return [];
    return [
      {
        id: "cherryPick",
        label: `Cherry-pick ${src.shortOid} onto ${dst.name}`,
        action: { type: "cherryPick", oid: src.oid, targetBranch: dst.isHead ? null : dst.name },
      },
    ];
  }
  if (src.kind === "commit" && dst.kind === "commit") {
    const onHead = ctx.onHead;
    if (src.oid === dst.oid || !onHead?.has(src.oid) || !onHead.has(dst.oid)) return [];
    // A larger row index is an older commit: the older one is the rebase base.
    const older =
      src.index !== undefined && dst.index !== undefined && src.index > dst.index ? src : dst;
    return [
      {
        id: "interactiveRebase",
        label: "Interactive rebase…",
        action: { type: "interactiveRebase", base: older.oid },
      },
    ];
  }
  if (src.kind !== "commit" && dst.kind === "commit") return moveRefTo(src, dst);
  return [];
}
