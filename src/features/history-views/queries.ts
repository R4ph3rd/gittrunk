import { useQuery, type QueryClient } from "@tanstack/react-query";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { queryKeys } from "@/ipc/queries";

/*
 * History data hangs under the graph key (invalidated on ref changes); submodules and worktrees
 * under the refs key. Both prefixes are already invalidated by `repo-changed`.
 */
export const historyKeys = {
  blame: (id: string, path: string, rev: string | null) =>
    [...queryKeys.graph(id), "blame", path, rev] as const,
  fileHistory: (id: string, path: string) => [...queryKeys.graph(id), "fileHistory", path] as const,
  reflog: (id: string, ref: string) => [...queryKeys.graph(id), "reflog", ref] as const,
  submodules: (id: string) => [...queryKeys.refs(id), "submodules"] as const,
  worktrees: (id: string) => [...queryKeys.refs(id), "worktrees"] as const,
};

export const FILE_HISTORY_LIMIT = 500;
export const REFLOG_LIMIT = 500;

export function useBlame(repoId: string, path: string, rev: string | null) {
  return useQuery({
    queryKey: historyKeys.blame(repoId, path, rev),
    queryFn: () => unwrap(commands.blame(repoId, path, rev)),
  });
}

export function useFileHistory(repoId: string, path: string) {
  return useQuery({
    queryKey: historyKeys.fileHistory(repoId, path),
    queryFn: () => unwrap(commands.fileHistory(repoId, path, FILE_HISTORY_LIMIT)),
  });
}

export function useReflog(repoId: string, refName: string) {
  return useQuery({
    queryKey: historyKeys.reflog(repoId, refName),
    queryFn: () => unwrap(commands.reflog(repoId, refName, REFLOG_LIMIT)),
  });
}

export function useSubmodules(repoId: string) {
  return useQuery({
    queryKey: historyKeys.submodules(repoId),
    queryFn: () => unwrap(commands.submoduleList(repoId)),
  });
}

export function useWorktrees(repoId: string) {
  return useQuery({
    queryKey: historyKeys.worktrees(repoId),
    queryFn: () => unwrap(commands.worktreeList(repoId)),
  });
}

export function invalidateSidebarLists(client: QueryClient, repoId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: historyKeys.submodules(repoId) }),
    client.invalidateQueries({ queryKey: historyKeys.worktrees(repoId) }),
  ]);
}
