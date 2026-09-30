import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  commands,
  type ConflictResolution,
  type InteractiveRebaseRequest,
  type SequencerAction,
} from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateEverything, queryKeys } from "@/ipc/queries";

/** Query keys for operation data, scoped by repo id so `repo-changed` prefixes still match. */
export const opKeys = {
  conflicts: (id: string) => ["repo", id, "conflicts"] as const,
  conflictFile: (id: string, path: string) => ["repo", id, "conflicts", "file", path] as const,
  todo: (id: string, base: string) => ["repo", id, "rebaseTodo", base] as const,
};

export function useConflictFile(repoId: string, path: string | null) {
  return useQuery({
    queryKey: opKeys.conflictFile(repoId, path ?? ""),
    queryFn: () => unwrap(commands.conflictFile(repoId, path!)),
    enabled: path !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useRebaseTodo(repoId: string, base: string | null) {
  return useQuery({
    queryKey: opKeys.todo(repoId, base ?? ""),
    queryFn: () => unwrap(commands.rebaseTodoLoad(repoId, base!)),
    enabled: base !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

/** After anything that changes an in-progress operation: everything plus the conflict caches. */
export function invalidateOperation(client: QueryClient, repoId: string) {
  return Promise.all([
    invalidateEverything(client, repoId),
    // Do not refetch an open resolver: its file is no longer conflicted once resolved.
    client.invalidateQueries({ queryKey: opKeys.conflicts(repoId), refetchType: "none" }),
  ]);
}

export function useConflictResolve(repoId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { path: string; resolution: ConflictResolution }) =>
      unwrap(commands.conflictResolve(repoId, v.path, v.resolution)),
    onSettled: () => invalidateOperation(client, repoId),
  });
}

export function useSequencerControl(repoId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: SequencerAction) => unwrap(commands.sequencerControl(repoId, action)),
    onSettled: () => invalidateOperation(client, repoId),
  });
}

export function useRebaseInteractive(repoId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { request: InteractiveRebaseRequest; dryRun: boolean }) =>
      unwrap(commands.rebaseInteractive(repoId, v.request, v.dryRun)),
    onSettled: (_d, _e, v) => (v.dryRun ? undefined : invalidateOperation(client, repoId)),
  });
}

/** Full messages (summary + body) of the given commits, keyed by oid. `ready` when all loaded. */
export function useCommitMessages(repoId: string, oids: string[]) {
  const results = useQueries({
    queries: oids.map((oid) => ({
      queryKey: queryKeys.commit(repoId, oid),
      queryFn: () => unwrap(commands.commitDetails(repoId, oid)),
      staleTime: Infinity,
    })),
  });
  const messages: Record<string, string> = {};
  results.forEach((r, i) => {
    if (r.data)
      messages[oids[i]!] = r.data.body ? `${r.data.summary}\n\n${r.data.body}` : r.data.summary;
  });
  return { messages, ready: results.every((r) => !r.isPending) };
}
