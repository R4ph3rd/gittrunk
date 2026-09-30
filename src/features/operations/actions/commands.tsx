import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRegisterCommands, type Command } from "@/app/commands";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { queryKeys } from "@/ipc/queries";
import { selectedOidOf, useRepoStore } from "@/stores/repo";
import { buildActionEntries } from "./entries";
import { makeActionContext } from "./useActionContext";
import type { ActionEntry } from "./types";

const MAX_BRANCH_COMMANDS = 60;

function toCommands(
  entries: ActionEntry[],
  idPrefix: string,
  group: string,
  repoId: string,
  keywords: string[],
): Command[] {
  const out: Command[] = [];
  for (const e of entries) {
    if (e.kind !== "item" || !e.palette) continue;
    out.push({
      id: `${idPrefix}.${e.id}`,
      title: e.paletteTitle ?? e.label,
      group,
      icon: e.icon,
      keywords,
      when: (ctx) => ctx.repoId === repoId,
      run: () => e.run(),
    });
  }
  return out;
}

/**
 * Palette commands for the selected commit and for every branch: the keyboard equivalent of the
 * drag and drop actions. Mounted by the provider; registered only while a repository is active.
 */
export function OperationCommands() {
  const client = useQueryClient();
  const repoId = useRepoStore((s) => s.activeId);
  const selectedOid = useRepoStore((s) =>
    s.activeId ? selectedOidOf(s.selection[s.activeId]) : null,
  );
  const refs = useQuery({
    queryKey: queryKeys.refs(repoId ?? ""),
    queryFn: () => unwrap(commands.refsList(repoId ?? "")),
    enabled: repoId !== null,
  });
  const data = refs.data;

  const list: Command[] = [];
  if (repoId) {
    const ctx = makeActionContext(client, repoId);
    ctx.head = data?.head ?? ctx.head;
    if (selectedOid) {
      const shortOid = selectedOid.slice(0, 7);
      list.push(
        ...toCommands(
          buildActionEntries({ kind: "commit", oid: selectedOid, shortOid }, ctx),
          "ops.commit",
          "Selected commit",
          repoId,
          ["git", shortOid],
        ),
      );
    }
    const branches = [
      ...(data?.local ?? []).map((b) => ({ b, remote: false })),
      ...(data?.remote ?? []).map((b) => ({ b, remote: true })),
    ].slice(0, MAX_BRANCH_COMMANDS);
    for (const { b, remote } of branches) {
      list.push(
        ...toCommands(
          buildActionEntries(
            {
              kind: "branch",
              name: b.name,
              fullName: b.fullName,
              remote,
              isHead: b.isHead,
              oid: b.oid,
            },
            ctx,
          ),
          `ops.branch.${b.fullName}`,
          "Branches",
          repoId,
          [b.name, "branch"],
        ),
      );
    }
  }

  useRegisterCommands(list, [repoId, selectedOid, data, client]);
  return null;
}
