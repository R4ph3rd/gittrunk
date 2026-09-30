import type { QueryClient } from "@tanstack/react-query";
import { runOp } from "@/features/ops/ops";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { invalidateSidebarLists } from "./queries";

export interface SubmoduleUpdate {
  paths: string[];
  init: boolean;
  recursive: boolean;
}

/** Runs `submoduleUpdate` as a tracked background operation. */
export function updateSubmodules(
  client: QueryClient,
  repoId: string,
  update: SubmoduleUpdate,
  what: string,
) {
  return runOp({
    kind: "fetch",
    repoId,
    label: `Updating ${what}`,
    doneLabel: `Updated ${what}`,
    start: () => unwrap(commands.submoduleUpdate(repoId, update)),
    onSuccess: async () => {
      await invalidateSidebarLists(client, repoId);
    },
  });
}
