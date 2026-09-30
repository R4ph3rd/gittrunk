import type { QueryClient } from "@tanstack/react-query";
import type { GraphRow } from "@/ipc/bindings";
import { queryKeys } from "@/ipc/queries";

/** Graph rows already in the query cache for a repo, keyed by oid. */
export function cachedRows(client: QueryClient, repoId: string): Map<string, GraphRow> {
  const map = new Map<string, GraphRow>();
  const pages = client.getQueriesData<GraphRow[]>({
    queryKey: [...queryKeys.graph(repoId), "rows"],
  });
  for (const [, rows] of pages) for (const row of rows ?? []) map.set(row.oid, row);
  return map;
}
