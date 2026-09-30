import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { usePlatform } from "@/app/platform";
import { ActionSheet, AlertDialog, toast } from "@/design/components";
import { commands, type RecentRepo } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { queryKeys } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { isDeletablePath } from "./recentPaths";
import { useCloseRepo } from "./useOpenRepo";

/**
 * Delete flow for recent repositories under `defaultReposDir`: an action sheet, then a
 * confirmation, then `repo_delete`. `flow` must be rendered once next to the list.
 */
export function useRecentDelete(): {
  canDelete: (path: string) => boolean;
  openMenu: (repo: RecentRepo) => void;
  flow: ReactNode;
} {
  const { defaultReposDir } = usePlatform();
  const client = useQueryClient();
  const close = useCloseRepo();
  const [menu, setMenu] = useState<RecentRepo | null>(null);
  const [confirm, setConfirm] = useState<RecentRepo | null>(null);

  const remove = async (repo: RecentRepo) => {
    try {
      const open = useRepoStore.getState().repos.find((r) => r.path === repo.path);
      if (open) await close(open.id);
      await unwrap(commands.repoDelete(repo.path));
      toast.success(`Deleted ${repo.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      await client.invalidateQueries({ queryKey: queryKeys.recent });
    }
  };

  const flow = (
    <>
      <ActionSheet
        open={menu !== null}
        onOpenChange={(o) => !o && setMenu(null)}
        title={menu?.name ?? ""}
        {...(menu ? { description: menu.path } : {})}
        items={[
          {
            id: "delete",
            label: "Delete repository",
            icon: <Trash2 />,
            destructive: true,
            onSelect: () => setConfirm(menu),
          },
        ]}
      />
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${confirm?.name ?? "repository"}?`}
        description="This permanently removes the repository folder and all of its local history from this device. Commits that were never pushed are lost."
        preview={confirm?.path}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (confirm) void remove(confirm);
        }}
      />
    </>
  );

  return {
    canDelete: (path) => isDeletablePath(path, defaultReposDir),
    openMenu: setMenu,
    flow,
  };
}
