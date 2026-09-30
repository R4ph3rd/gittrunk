import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/design/components";
import { runOp } from "@/features/ops/ops";
import {
  commands,
  type BranchInfo,
  type PullStrategy,
  type RefsSnapshot,
  type RemoteInfo,
} from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { queryKeys } from "@/ipc/queries";
import { useRemotesUi } from "@/stores/remotes";

export const STRATEGY_LABEL: Record<PullStrategy, string> = {
  merge: "Merge",
  rebase: "Rebase",
  ffOnly: "Fast-forward only",
};

/** Splits `origin/feature/x` into its remote and branch, preferring the longest known remote name. */
export function splitUpstream(
  upstream: string,
  remoteNames: string[],
): { remote: string; branch: string } {
  const match = [...remoteNames]
    .sort((a, b) => b.length - a.length)
    .find((r) => upstream.startsWith(`${r}/`));
  if (match) return { remote: match, branch: upstream.slice(match.length + 1) };
  const i = upstream.indexOf("/");
  return i < 0
    ? { remote: upstream, branch: "" }
    : { remote: upstream.slice(0, i), branch: upstream.slice(i + 1) };
}

export const headBranch = (refs: RefsSnapshot | undefined): BranchInfo | null =>
  refs?.local.find((b) => b.isHead) ?? null;

export const branchRef = (name: string) => `refs/heads/${name}`;

const fresh = <T>(client: QueryClient, queryKey: readonly unknown[], queryFn: () => Promise<T>) =>
  client.fetchQuery({ queryKey, queryFn, staleTime: 0 });

export const loadRefs = (client: QueryClient, repoId: string) =>
  fresh(client, queryKeys.refs(repoId), () => unwrap(commands.refsList(repoId)));

export const loadRemotes = (client: QueryClient, repoId: string): Promise<RemoteInfo[]> =>
  fresh(client, queryKeys.remotes(repoId), () => unwrap(commands.remoteList(repoId)));

export function fetchRemote(repoId: string, remote: string | null) {
  return runOp({
    kind: "fetch",
    repoId,
    label: remote ? `Fetching ${remote}` : "Fetching all remotes",
    doneLabel: "Fetch complete",
    start: () => unwrap(commands.fetch(repoId, { remote, prune: true, tags: false })),
  });
}

export async function pullCurrent(
  client: QueryClient,
  repoId: string,
  strategy: PullStrategy = useRemotesUi.getState().pullStrategy,
) {
  const [refs, remotes] = await Promise.all([
    loadRefs(client, repoId),
    loadRemotes(client, repoId),
  ]);
  const branch = headBranch(refs);
  if (!branch?.upstream) {
    toast.warning("The current branch has no upstream to pull from");
    return null;
  }
  const up = splitUpstream(
    branch.upstream,
    remotes.map((r) => r.name),
  );
  return runOp({
    kind: "pull",
    repoId,
    label: `Pulling ${branch.name} (${STRATEGY_LABEL[strategy].toLowerCase()})`,
    doneLabel: "Pull complete",
    start: () => unwrap(commands.pull(repoId, { remote: up.remote, branch: up.branch, strategy })),
  });
}

export interface PushTarget {
  remote: string;
  branch: string;
  remoteBranch: string;
  setUpstream: boolean;
  forceWithLease: boolean;
}

export function pushTo(repoId: string, t: PushTarget) {
  return runOp({
    kind: "push",
    repoId,
    label: `Pushing ${t.branch} to ${t.remote}`,
    doneLabel: "Push complete",
    start: () =>
      unwrap(
        commands.push(repoId, {
          remote: t.remote,
          refspecs: [`${branchRef(t.branch)}:${branchRef(t.remoteBranch)}`],
          forceWithLease: t.forceWithLease,
          setUpstream: t.setUpstream,
          tags: false,
        }),
      ),
  });
}

/**
 * Pushes a branch (default: current) to its upstream. Without an upstream it opens the
 * "push and set upstream" dialog instead.
 */
export async function pushBranch(
  client: QueryClient,
  repoId: string,
  opts: { branch?: string | null; forceWithLease?: boolean } = {},
) {
  const [refs, remotes] = await Promise.all([
    loadRefs(client, repoId),
    loadRemotes(client, repoId),
  ]);
  const branch = opts.branch ? refs.local.find((b) => b.name === opts.branch) : headBranch(refs);
  if (!branch) {
    toast.warning("Check out a branch to push");
    return null;
  }
  if (!branch.upstream) {
    useRemotesUi.getState().setPushDialog({ repoId, branch: branch.name });
    return null;
  }
  const up = splitUpstream(
    branch.upstream,
    remotes.map((r) => r.name),
  );
  return pushTo(repoId, {
    remote: up.remote,
    branch: branch.name,
    remoteBranch: up.branch || branch.name,
    setUpstream: false,
    forceWithLease: opts.forceWithLease ?? false,
  });
}
