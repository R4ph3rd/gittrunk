import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/design/components";
import { runOp } from "@/features/ops/ops";
import { loadRefs } from "@/features/remotes/actions";
import { commands, type CheckoutTarget, type ForgePull, type RefsSnapshot } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateAfterOp } from "@/ipc/queries";
import { errorMessage } from "../helpers";

/** The checkout target for the head branch when it exists locally or as a tracking branch. */
export function checkoutTarget(
  refs: RefsSnapshot,
  name: string,
  remote: string,
): CheckoutTarget | null {
  if (refs.local.some((b) => b.name === name)) return { kind: "branch", name };
  if (refs.remote.some((b) => b.fullName === `refs/remotes/${remote}/${name}`)) {
    return { kind: "remoteBranch", name: `${remote}/${name}`, localName: name };
  }
  return null;
}

/** True when HEAD is on the pull request's head branch (never for forks). */
export function isCheckedOut(refs: RefsSnapshot | undefined, pull: ForgePull): boolean {
  return !pull.head.isFork && refs?.head.kind === "branch" && refs.head.name === pull.head.name;
}

async function run(client: QueryClient, repoId: string, target: CheckoutTarget, name: string) {
  try {
    const outcome = await unwrap(commands.checkout(repoId, target, false));
    if (outcome.kind === "conflicted") {
      toast.warning(`Checked out ${name} with conflicts in ${outcome.files.length} file(s)`);
    } else {
      toast.success(`Checked out ${name}`);
    }
  } catch (e) {
    toast.error(`Could not check out ${name}: ${errorMessage(e)}`);
  } finally {
    await invalidateAfterOp(client, repoId);
  }
}

/** Checks out the PR head branch: local branch, else a tracking branch, else fetch then retry. */
export async function checkoutPull(
  client: QueryClient,
  repoId: string,
  pull: ForgePull,
  remote: string,
): Promise<void> {
  const name = pull.head.name;
  if (pull.head.isFork) return;
  let refs: RefsSnapshot;
  try {
    refs = await loadRefs(client, repoId);
  } catch (e) {
    toast.error(`Could not check out ${name}: ${errorMessage(e)}`);
    return;
  }
  const target = checkoutTarget(refs, name, remote);
  if (target) return run(client, repoId, target, name);

  await runOp({
    kind: "fetch",
    repoId,
    label: `Fetching ${remote}`,
    doneLabel: "Fetch complete",
    start: () => unwrap(commands.fetch(repoId, { remote, prune: false, tags: false })),
    onSuccess: async () => {
      const fresh = await loadRefs(client, repoId).catch(() => null);
      const retry = fresh ? checkoutTarget(fresh, name, remote) : null;
      if (retry) await run(client, repoId, retry, name);
      else toast.error(`Branch ${name} not found on ${remote}`);
    },
  });
}
