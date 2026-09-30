import { useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  commands,
  events,
  type AvatarSubject,
  type CommitRequest,
  type DiffOptions,
  type GitIdentity,
  type GraphFilter,
  type IssueCreateRequest,
  type IssueStateFilter,
  type LineSelection,
  type RepoChanged,
  type StashSaveRequest,
} from "./bindings";
import { DEFAULT_FILTER, useRepoStore } from "@/stores/repo";
import { useSettings } from "@/stores/settings";
import { unwrap } from "./client";

/** Query keys are scoped by repo id so `repo-changed` events can invalidate precisely. */
export const queryKeys = {
  appInfo: ["appInfo"] as const,
  platformInfo: ["platformInfo"] as const,
  gitIdentity: ["gitIdentity"] as const,
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
  oplogState: (id: string) => ["repo", id, "oplog"] as const,
  avatar: (key: string, size: number) => ["avatar", key, size] as const,
  /** Not under ["repo", id]: repo-changed must not refetch the network. */
  forge: {
    all: ["forge"] as const,
    status: (id: string) => ["forge", id, "status"] as const,
    issues: (id: string, state: IssueStateFilter) => ["forge", id, "issues", state] as const,
    issue: (id: string, n: number) => ["forge", id, "issue", n] as const,
    commitComments: (id: string, oid: string) => ["forge", id, "commitComments", oid] as const,
    tokenSource: (host: string) => ["forge", "token", host] as const,
  },
};

export function useAppInfo() {
  return useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: () => unwrap(commands.appInfo()),
    staleTime: Infinity,
  });
}

/** Compile-time platform capabilities. Prefer `usePlatform()` in components. */
export function usePlatformInfo() {
  return useQuery({
    queryKey: queryKeys.platformInfo,
    queryFn: () => unwrap(commands.platformInfo()),
    staleTime: Infinity,
    retry: false,
  });
}

/** Global git identity (`user.name` / `user.email`). */
export function useGitIdentity() {
  return useQuery({
    queryKey: queryKeys.gitIdentity,
    queryFn: () => unwrap(commands.gitIdentityGet()),
  });
}

export function useSetGitIdentity() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (identity: { name: string; email: string }): Promise<GitIdentity> =>
      unwrap(commands.gitIdentitySet(identity.name, identity.email)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.gitIdentity }),
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

const NO_COLORS: ReadonlyMap<string, number> = new Map();

/** Lane color per ref full name, from the graph meta of the repo's current filter. */
export function useRefColors(repoId: string | null): ReadonlyMap<string, number> {
  const filter = useRepoStore((s) => (repoId ? s.filters[repoId] : undefined)) ?? DEFAULT_FILTER;
  const { data } = useQuery({
    queryKey: queryKeys.graphMeta(repoId ?? "", filter),
    queryFn: () => unwrap(commands.graphLoad(repoId!, filter)),
    enabled: repoId !== null,
    staleTime: Infinity,
  });
  const refColors = data?.refColors;
  return useMemo(
    () => (refColors ? new Map(refColors.map((r) => [r.fullName, r.color])) : NO_COLORS),
    [refColors],
  );
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
    client.invalidateQueries({ queryKey: queryKeys.oplogState(repoId) }),
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

export function useRedo(repoId: string) {
  return useRepoMutation(repoId, () => unwrap(commands.redo(repoId, false)), "all");
}

/** Undo/redo availability and descriptions. Refetched by `invalidateEverything` and the "refs" scope. */
export function useOplogState(repoId: string) {
  return useQuery({
    queryKey: queryKeys.oplogState(repoId),
    queryFn: () => unwrap(commands.oplogState(repoId)),
  });
}

/* ---- Avatars ---- */

/** Stable cache key of a subject: "email:<trimmed lower-case>" | "github:<lower-case login>". */
export function avatarKey(subject: AvatarSubject): string {
  return subject.kind === "email"
    ? `email:${subject.email.trim().toLowerCase()}`
    : `github:${subject.login.trim().toLowerCase()}`;
}

const AVATAR_CHUNK = 100;
const DEFAULT_AVATAR_SIZE = 64;

type Slot = { ok: true; value: string | null } | { ok: false };

/** Asks the backend in chunks of 100. A failed chunk marks its subjects as failed. */
async function requestChunked(subjects: AvatarSubject[], size: number): Promise<Map<string, Slot>> {
  const out = new Map<string, Slot>();
  for (let i = 0; i < subjects.length; i += AVATAR_CHUNK) {
    const chunk = subjects.slice(i, i + AVATAR_CHUNK);
    try {
      const res = await unwrap(commands.avatarsGet(chunk, size));
      chunk.forEach((s, k) => out.set(avatarKey(s), { ok: true, value: res[k] ?? null }));
    } catch {
      chunk.forEach((s) => out.set(avatarKey(s), { ok: false }));
    }
  }
  return out;
}

/**
 * Cached results first; the rest via `commands.avatarsGet` in chunks of 100. Results are stored
 * with `setQueryData`; failures resolve to null and are not cached.
 */
export async function fetchAvatars(
  client: QueryClient,
  subjects: AvatarSubject[],
  size: number = DEFAULT_AVATAR_SIZE,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const missing = new Map<string, AvatarSubject>();
  for (const s of subjects) {
    const key = avatarKey(s);
    if (result.has(key) || missing.has(key)) continue;
    const cached = client.getQueryData<string | null>(queryKeys.avatar(key, size));
    if (cached !== undefined) result.set(key, cached);
    else missing.set(key, s);
  }
  if (missing.size > 0) {
    const fetched = await requestChunked([...missing.values()], size);
    for (const key of missing.keys()) {
      const slot = fetched.get(key);
      if (slot?.ok) {
        client.setQueryData(queryKeys.avatar(key, size), slot.value);
        result.set(key, slot.value);
      } else {
        result.set(key, null);
      }
    }
  }
  return result;
}

interface Pending {
  subjects: Map<string, AvatarSubject>;
  waiters: Map<string, { resolve: (v: string | null) => void; reject: (e: Error) => void }[]>;
}
const pendingAvatars = new Map<number, Pending>();

/** Joins the batch of this tick for `size`; one `avatarsGet` per size and tick. */
function requestAvatar(subject: AvatarSubject, size: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let batch = pendingAvatars.get(size);
    if (!batch) {
      const created: Pending = { subjects: new Map(), waiters: new Map() };
      batch = created;
      pendingAvatars.set(size, created);
      setTimeout(() => {
        pendingAvatars.delete(size);
        void requestChunked([...created.subjects.values()], size).then((slots) => {
          for (const [key, list] of created.waiters) {
            const slot = slots.get(key);
            for (const w of list) {
              if (slot?.ok) w.resolve(slot.value);
              else w.reject(new Error("avatar unavailable"));
            }
          }
        });
      }, 0);
    }
    const key = avatarKey(subject);
    batch.subjects.set(key, subject);
    const list = batch.waiters.get(key) ?? [];
    list.push({ resolve, reject });
    batch.waiters.set(key, list);
  });
}

/** data: URL or null. Calls made in the same tick are batched into one avatarsGet per size. */
export function useAvatar(
  subject: AvatarSubject | null,
  size: number = DEFAULT_AVATAR_SIZE,
): string | null {
  const key = subject ? avatarKey(subject) : "";
  const { data } = useQuery({
    queryKey: queryKeys.avatar(key, size),
    queryFn: () => requestAvatar(subject!, size),
    enabled: subject !== null,
    staleTime: Infinity,
    retry: false,
  });
  return data ?? null;
}

/** Call after the avatar setting changes: drops every cached avatar and refetches the visible ones. */
export function invalidateAvatars(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: ["avatar"] });
}

/* ---- Forge (issues and comments) ---- */

export function useForgeStatus(repoId: string | null) {
  return useQuery({
    queryKey: queryKeys.forge.status(repoId ?? ""),
    queryFn: () => unwrap(commands.forgeStatus(repoId!)),
    enabled: repoId !== null,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useForgeTokenSource(host: string) {
  return useQuery({
    queryKey: queryKeys.forge.tokenSource(host),
    queryFn: () => unwrap(commands.forgeTokenSource(host)),
  });
}

export function useIssues(
  repoId: string,
  state: IssueStateFilter,
  opts: { enabled?: boolean; perPage?: number } = {},
) {
  const perPage = opts.perPage ?? 30;
  return useInfiniteQuery({
    queryKey: queryKeys.forge.issues(repoId, state),
    queryFn: ({ pageParam }) =>
      unwrap(commands.forgeIssues(repoId, { state, page: pageParam, perPage })),
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextPage ?? undefined,
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });
}

export function useIssue(repoId: string, number: number | null) {
  return useQuery({
    queryKey: queryKeys.forge.issue(repoId, number ?? 0),
    queryFn: () => unwrap(commands.forgeIssue(repoId, number!)),
    enabled: number !== null,
    staleTime: 30_000,
  });
}

export function useCreateIssue(repoId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: IssueCreateRequest) => unwrap(commands.forgeIssueCreate(repoId, req)),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: [...queryKeys.forge.all, repoId, "issues"] }),
  });
}

export function useAddIssueComment(repoId: string, number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => unwrap(commands.forgeIssueComment(repoId, number, body)),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.forge.issue(repoId, number) }),
        client.invalidateQueries({ queryKey: [...queryKeys.forge.all, repoId, "issues"] }),
      ]),
  });
}

export function useCommitComments(repoId: string, oid: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.forge.commitComments(repoId, oid ?? ""),
    queryFn: () => unwrap(commands.forgeCommitComments(repoId, oid!)),
    enabled: enabled && oid !== null,
    staleTime: 30_000,
  });
}

export function useAddCommitComment(repoId: string, oid: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => unwrap(commands.forgeCommitComment(repoId, oid, body)),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.forge.commitComments(repoId, oid) }),
  });
}

export function useSetForgeToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { host: string; token: string }) =>
      unwrap(commands.forgeTokenSet(v.host, v.token)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.forge.all }),
  });
}

export function useClearForgeToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (host: string) => unwrap(commands.forgeTokenClear(host)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.forge.all }),
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
      void client.invalidateQueries({ queryKey: queryKeys.oplogState(id) });
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
