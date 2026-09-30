import { toast } from "@/design/components";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { useRepoStore } from "@/stores/repo";

/** Opens a submodule or worktree folder as its own repository tab. */
export async function openAsRepository(path: string): Promise<void> {
  try {
    const info = await unwrap(commands.repoOpen(path));
    useRepoStore.getState().addRepo(info);
  } catch (e) {
    toast.error(`Could not open ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Joins a repo-relative path onto the repository root. */
export function joinPath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${relative}`;
}
