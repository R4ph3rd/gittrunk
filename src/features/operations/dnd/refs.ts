import type { BranchInfo, TagInfo } from "@/ipc/bindings";
import type { ActionTarget } from "../actions/types";
import type { DndNodeConfig } from "./useDndNode";

/** Drag and drop config for a branch in the sidebar (local branches are also drop targets). */
export function branchDnd(repoId: string, b: BranchInfo, remote: boolean): DndNodeConfig {
  const ref = {
    kind: "branch",
    name: b.name,
    fullName: b.fullName,
    remote,
    isHead: b.isHead,
    oid: b.oid,
  } as const;
  return {
    id: `side:${b.fullName}`,
    repoId,
    keyboard: true,
    source: ref,
    target: remote ? undefined : ref,
  };
}

export function tagDnd(repoId: string, t: TagInfo): DndNodeConfig {
  return {
    id: `side:refs/tags/${t.name}`,
    repoId,
    keyboard: true,
    source: { kind: "tag", name: t.name, fullName: `refs/tags/${t.name}`, oid: t.oid },
  };
}

export function branchActionTarget(b: BranchInfo, remote: boolean): ActionTarget {
  return {
    kind: "branch",
    name: b.name,
    fullName: b.fullName,
    remote,
    isHead: b.isHead,
    oid: b.oid,
  };
}
