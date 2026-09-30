import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { commands, events, type DiffOptions, type GraphFilter, type RepoChanged } from "./bindings";
import { unwrap } from "./client";

/** Query keys are scoped by repo id so `repo-changed` events can invalidate precisely. */
export const queryKeys = {
  appInfo: ["appInfo"] as const,
  recent: ["repoRecent"] as const,
  repo: (id: string) => ["repo", id] as const,
  info: (id: string) => ["repo", id, "info"] as const,
  refs: (id: string) => ["repo", id, "refs"] as const,
  status: (id: string) => ["repo", id, "status"] as const,
  graph: (id: string) => ["repo", id, "graph"] as const,
  graphMeta: (id: string, filter: GraphFilter) => ["repo", id, "graph", "meta", filter] as const,
  graphRows: (id: string, generation: number, filter: GraphFilter, page: number) =>
    ["repo", id, "graph", "rows", generation, filter, page] as const,
  graphSearch: (id: string, generation: number, text: string) =>
    ["repo", id, "graph", "search", generation, text] as const,
  commit: (id: string, oid: string) => ["repo", id, "commit", oid] as const,
  fileDiff: (id: string, oid: string, path: string, options: DiffOptions) =>
    ["repo", id, "commit", oid, "diff", path, options] as const,
};

export function useAppInfo() {
  return useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: () => unwrap(commands.appInfo()),
    staleTime: Infinity,
  });
}

export function useRecentRepos() {
  return useQuery({ queryKey: queryKeys.recent, queryFn: () => unwrap(commands.repoRecent()) });
}

export function useRepoInfo(repoId: string) {
  return useQuery({
    queryKey: queryKeys.info(repoId),
    queryFn: () => unwrap(commands.repoInfo(repoId)),
  });
}

export function useRefs(repoId: string) {
  return useQuery({
    queryKey: queryKeys.refs(repoId),
    queryFn: () => unwrap(commands.refsList(repoId)),
  });
}

export function useStatus(repoId: string) {
  return useQuery({
    queryKey: queryKeys.status(repoId),
    queryFn: () => unwrap(commands.status(repoId)),
  });
}

export function useGraphMeta(repoId: string, filter: GraphFilter) {
  return useQuery({
    queryKey: queryKeys.graphMeta(repoId, filter),
    queryFn: () => unwrap(commands.graphLoad(repoId, filter)),
    staleTime: Infinity,
  });
}

export const PAGE_SIZE = 200;

/** Options for one page of rows; `generation` is the meta's dataUpdatedAt so reloads never mix pages. */
export function graphPageOptions(
  repoId: string,
  generation: number,
  filter: GraphFilter,
  page: number,
) {
  return {
    queryKey: queryKeys.graphRows(repoId, generation, filter, page),
    queryFn: () => unwrap(commands.graphRows(repoId, page * PAGE_SIZE, PAGE_SIZE)),
    staleTime: Infinity,
    gcTime: 30_000, // small LRU: pages far from the viewport are dropped
  };
}

export function useGraphSearch(repoId: string, generation: number, text: string) {
  return useQuery({
    queryKey: queryKeys.graphSearch(repoId, generation, text),
    queryFn: () => unwrap(commands.graphSearch(repoId, { text, maxResults: 10_000 })),
    enabled: text.trim().length > 0,
    staleTime: Infinity,
  });
}

/** Finds the row index of a commit via the oid-prefix search. */
export async function locateOid(
  client: QueryClient,
  repoId: string,
  generation: number,
  oid: string,
): Promise<number | null> {
  const hits = await client.fetchQuery({
    queryKey: queryKeys.graphSearch(repoId, generation, oid),
    queryFn: () => unwrap(commands.graphSearch(repoId, { text: oid, maxResults: 1 })),
    staleTime: Infinity,
  });
  return hits[0] ?? null;
}

export function useCommitDetails(repoId: string, oid: string | null) {
  return useQuery({
    queryKey: queryKeys.commit(repoId, oid ?? ""),
    queryFn: () => unwrap(commands.commitDetails(repoId, oid!)),
    enabled: oid !== null,
    staleTime: Infinity,
  });
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = { contextLines: 3, ignoreWhitespace: false };

export function useFileDiff(repoId: string, oid: string, path: string | null) {
  return useQuery({
    queryKey: queryKeys.fileDiff(repoId, oid, path ?? "", DEFAULT_DIFF_OPTIONS),
    queryFn: () => unwrap(commands.commitFileDiff(repoId, oid, path!, DEFAULT_DIFF_OPTIONS)),
    enabled: path !== null,
    staleTime: Infinity,
  });
}

/** Maps a repo-changed payload onto the queries it invalidates. */
export function invalidateForChange(client: QueryClient, change: RepoChanged) {
  const id = change.repoId;
  for (const scope of change.scopes) {
    if (scope === "refs") {
      void client.invalidateQueries({ queryKey: queryKeys.refs(id) });
      void client.invalidateQueries({ queryKey: queryKeys.graph(id) });
      void client.invalidateQueries({ queryKey: queryKeys.info(id) });
    } else if (scope === "index" || scope === "worktree") {
      void client.invalidateQueries({ queryKey: queryKeys.status(id) });
    } else if (scope === "config") {
      void client.invalidateQueries({ queryKey: queryKeys.info(id) });
    }
  }
}

/** Subscribes to `repo-changed` for one repo and invalidates by scope. */
export function useRepoEvents(repoId: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    if (!repoId) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void events.repoChanged
      .listen((e) => {
        if (e.payload.repoId === repoId) invalidateForChange(client, e.payload);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [client, repoId]);
}
