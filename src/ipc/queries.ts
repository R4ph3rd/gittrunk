import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  commands,
  events,
  type CommitRequest,
  type DiffOptions,
  type GraphFilter,
  type LineSelection,
  type RepoChanged,
  type StashSaveRequest,
} from "./bindings";
import { useSettings } from "@/stores/settings";
import { unwrap } from "./client";

/** Query keys are scoped by repo id so `repo-changed` events can invalidate precisely. */
export const queryKeys = {
  appInfo: ["appInfo"] as const,
  aiSettings: ["aiSettings"] as const,
  recent: ["repoRecent"] as const,
  repo: (id: string) => ["repo", id] as const,
  info: (id: string) => ["repo", id, "info"] as const,
  refs: (id: string) => ["repo", id, "refs"] as const,
  status: (id: string) => ["repo", id, "status"] as const,
  remotes: (id: string) => ["repo", id, "remotes"] as const,
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

/** AI settings (global, not repo scoped). Invalidate `queryKeys.aiSettings` after saving. */
export function useAiSettings() {
  return useQuery({
    queryKey: queryKeys.aiSettings,
    queryFn: () => unwrap(commands.aiSettingsGet()),
    retry: false,
  });
}

/** True only once the backend confirmed AI is enabled. */
export function useAiEnabled(): boolean {
  return useAiSettings().data?.enabled === true;
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

export function useRemotes(repoId: string) {
  return useQuery({
    queryKey: queryKeys.remotes(repoId),
    queryFn: () => unwrap(commands.remoteList(repoId)),
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

/* ---- Working copy (staging) ---- */

/** Diff options for staging views (context lines follow settings). Line selections must be built against exactly these. */
export function useStagingDiffOptions(): DiffOptions {
  const contextLines = useSettings().diffContextLines;
  return useMemo(() => ({ contextLines, ignoreWhitespace: false }), [contextLines]);
}

export const worktreeKeys = {
  all: (id: string) => ["repo", id, "worktree"] as const,
  diff: (id: string, path: string, staged: boolean, options: DiffOptions) =>
    ["repo", id, "worktree", "diff", path, staged, options] as const,
};

export function useWorktreeDiff(repoId: string, path: string | null, staged: boolean) {
  const options = useStagingDiffOptions();
  return useQuery({
    queryKey: worktreeKeys.diff(repoId, path ?? "", staged, options),
    queryFn: () => unwrap(commands.worktreeFileDiff(repoId, path!, staged, options)),
    enabled: path !== null,
  });
}

/** Refetches status and every worktree/index diff (the staged and unstaged views of one file). */
export function invalidateWorkingCopy(client: QueryClient, repoId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.status(repoId) }),
    client.invalidateQueries({ queryKey: worktreeKeys.all(repoId) }),
  ]);
}

/** After history-changing ops (commit, stash, undo): working copy plus refs, graph and info. */
export function invalidateEverything(client: QueryClient, repoId: string) {
  return Promise.all([
    invalidateWorkingCopy(client, repoId),
    client.invalidateQueries({ queryKey: queryKeys.refs(repoId) }),
    client.invalidateQueries({ queryKey: queryKeys.graph(repoId) }),
    client.invalidateQueries({ queryKey: queryKeys.info(repoId) }),
  ]);
}

/** After a remote operation finishes: refs, graph, status, info and the remote list. */
export function invalidateAfterOp(client: QueryClient, repoId: string) {
  return Promise.all([
    invalidateEverything(client, repoId),
    client.invalidateQueries({ queryKey: queryKeys.remotes(repoId) }),
  ]);
}

function useRepoMutation<V, R>(
  repoId: string,
  fn: (vars: V) => Promise<R>,
  scope: "working" | "all" = "working",
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      scope === "all"
        ? invalidateEverything(client, repoId)
        : invalidateWorkingCopy(client, repoId),
  });
}

export function useStagePaths(repoId: string) {
  return useRepoMutation(repoId, (paths: string[]) => unwrap(commands.stagePaths(repoId, paths)));
}

export function useUnstagePaths(repoId: string) {
  return useRepoMutation(repoId, (paths: string[]) => unwrap(commands.unstagePaths(repoId, paths)));
}

export function useStageLines(repoId: string) {
  return useRepoMutation(repoId, (sel: LineSelection) => unwrap(commands.stageLines(repoId, sel)));
}

export function useUnstageLines(repoId: string) {
  return useRepoMutation(repoId, (sel: LineSelection) =>
    unwrap(commands.unstageLines(repoId, sel)),
  );
}

export function useDiscardPaths(repoId: string) {
  return useRepoMutation(repoId, (v: { paths: string[]; dryRun: boolean }) =>
    unwrap(commands.discardPaths(repoId, v.paths, v.dryRun)),
  );
}

export function useDiscardLines(repoId: string) {
  return useRepoMutation(repoId, (v: { selection: LineSelection; dryRun: boolean }) =>
    unwrap(commands.discardLines(repoId, v.selection, v.dryRun)),
  );
}

export function useCommitCreate(repoId: string) {
  return useRepoMutation(
    repoId,
    (request: CommitRequest) => unwrap(commands.commitCreate(repoId, request)),
    "all",
  );
}

export function useStashSave(repoId: string) {
  return useRepoMutation(
    repoId,
    (request: StashSaveRequest) => unwrap(commands.stashSave(repoId, request)),
    "all",
  );
}

export function useStashApply(repoId: string) {
  return useRepoMutation(
    repoId,
    (v: { index: number; pop: boolean }) => unwrap(commands.stashApply(repoId, v.index, v.pop)),
    "all",
  );
}

export function useStashDrop(repoId: string) {
  return useRepoMutation(
    repoId,
    (v: { index: number; dryRun: boolean }) =>
      unwrap(commands.stashDrop(repoId, v.index, v.dryRun)),
    "all",
  );
}

export function useUndo(repoId: string) {
  return useRepoMutation(repoId, () => unwrap(commands.undo(repoId, false)), "all");
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
      void client.invalidateQueries({ queryKey: worktreeKeys.all(id) });
    } else if (scope === "config") {
      void client.invalidateQueries({ queryKey: queryKeys.info(id) });
      void client.invalidateQueries({ queryKey: queryKeys.remotes(id) });
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
