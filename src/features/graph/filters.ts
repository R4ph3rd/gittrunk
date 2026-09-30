import type { GraphFilter } from "@/ipc/bindings";

export function isFiltered(f: GraphFilter): boolean {
  return f.refs !== null || f.firstParent || f.order !== "topo" || !!f.author || !!f.path;
}
