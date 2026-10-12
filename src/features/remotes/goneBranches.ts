import type { BranchInfo } from "@/ipc/bindings";

/** Local branches whose remote branch was deleted. The checked-out branch is never offered. */
export const goneBranches = (local: BranchInfo[]) => local.filter((b) => b.upstreamGone);
export const deletableGoneBranches = (local: BranchInfo[]) =>
  goneBranches(local).filter((b) => !b.isHead);
