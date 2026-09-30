import type { QueryClient } from "@tanstack/react-query";
import type { RefsSnapshot } from "@/ipc/bindings";
import { queryKeys } from "@/ipc/queries";
import { cachedRows } from "../preview/rows";
import type { DragSource, DropContext } from "./types";

/**
 * Facts the drop table needs, computed once at drag start. Commit-to-commit drops need to know
 * which commits are on the current branch; that comes from the graph rows already cached.
 */
export function makeDropContext(
  client: QueryClient,
  repoId: string,
  source: DragSource,
): DropContext {
  const head = client.getQueryData<RefsSnapshot>(queryKeys.refs(repoId))?.head ?? null;
  if (source.kind !== "commit" || !head || head.kind === "unborn") return { head, onHead: null };
  const rows = cachedRows(client, repoId);
  const seen = new Set<string>();
  const stack = [head.oid];
  while (stack.length > 0) {
    const oid = stack.pop();
    if (!oid || seen.has(oid)) continue;
    seen.add(oid);
    for (const parent of rows.get(oid)?.parents ?? []) stack.push(parent);
  }
  return { head, onHead: seen };
}
