import { toast } from "@/design/components";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { useRepoStore } from "@/stores/repo";

/**
 * Selects a commit in the graph (the graph scrolls to the selection). Uses `graphFind` first so a
 * commit outside the current graph (filtered out, or unreachable) is reported instead of ignored.
 * Resolves to whether the commit was found.
 */
export async function revealCommit(repoId: string, oid: string): Promise<boolean> {
  try {
    const row = await unwrap(commands.graphFind(repoId, oid));
    if (row === null) {
      toast.warning(`Commit ${oid.slice(0, 7)} is not in the graph`, {
        description: "It may be hidden by a filter or unreachable from any ref.",
      });
      return false;
    }
    useRepoStore.getState().selectCommit(repoId, oid);
    return true;
  } catch (e) {
    toast.error(`Could not locate commit: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
