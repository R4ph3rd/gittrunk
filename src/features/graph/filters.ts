import type { GraphFilter } from "@/ipc/bindings";

/** True when the filter hides commits. Sort order is a view preference, not a filter. */
export function isFiltered(f: GraphFilter): boolean {
  return f.refs !== null || f.firstParent || !!f.author || !!f.path;
}
