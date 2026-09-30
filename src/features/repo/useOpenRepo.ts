import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { commands } from "@/ipc/bindings";
import { queryKeys } from "@/ipc/queries";
import { unwrap } from "@/ipc/client";
import { useRepoStore } from "@/stores/repo";

/** Opens a repository by path; failures (e.g. `notARepo`) land in the store as an inline error. */
export function useOpenRepo() {
  const client = useQueryClient();
  const addRepo = useRepoStore((s) => s.addRepo);
  const setOpenError = useRepoStore((s) => s.setOpenError);

  const openPath = useCallback(
    async (path: string) => {
      try {
        const info = await unwrap(commands.repoOpen(path));
        addRepo(info);
        void client.invalidateQueries({ queryKey: queryKeys.recent });
      } catch (err) {
        setOpenError(err instanceof Error ? err.message : String(err));
      }
    },
    [addRepo, client, setOpenError],
  );

  const pickAndOpen = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") await openPath(picked);
  }, [openPath]);

  return { openPath, pickAndOpen };
}

export function useCloseRepo() {
  const removeRepo = useRepoStore((s) => s.removeRepo);
  const client = useQueryClient();
  return useCallback(
    async (id: string) => {
      removeRepo(id);
      client.removeQueries({ queryKey: queryKeys.repo(id) });
      await commands.repoClose(id);
    },
    [client, removeRepo],
  );
}
