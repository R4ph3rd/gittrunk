import { useState } from "react";
import { Archive, ArrowDownToLine, Trash2, Undo2 } from "lucide-react";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import type { RouteScreenProps } from "@/app/layout/registry";
import { ActionSheet, Button, EmptyState, ListRow, Spinner } from "@/design/components";
import type { StashEntry } from "@/ipc/bindings";
import { useRefs } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { stashLabel, useStashActions } from "./useStashActions";

/** More > Stash: stash list with an action sheet per entry and a "Stash changes" button. */
export function StashScreen({ repoId }: RouteScreenProps<"stash">) {
  const refs = useRefs(repoId);
  const actions = useStashActions(repoId);
  const setStashDialog = useRepoStore((s) => s.setStashDialog);
  const [active, setActive] = useState<StashEntry | null>(null);
  const stashes = refs.data?.stashes ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar repoId={repoId} back title="Stash" />
      <div data-scroll-root="" className="min-h-0 flex-1 overflow-y-auto bg-surface">
        <div className="p-3">
          <Button variant="primary" className="w-full" onClick={() => setStashDialog(repoId, true)}>
            <Archive />
            Stash changes
          </Button>
        </div>
        {!refs.data ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : stashes.length === 0 ? (
          <EmptyState className="m-3" icon={<Archive />} title="No stashes" />
        ) : (
          <ul aria-label="Stashes">
            {stashes.map((s) => (
              <li key={s.oid}>
                <ListRow
                  title={stashLabel(s)}
                  subtitle={s.branch ? `on ${s.branch}` : undefined}
                  chevron
                  onClick={() => setActive(s)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      {active && (
        <ActionSheet
          open
          onOpenChange={(o) => !o && setActive(null)}
          title={stashLabel(active)}
          items={[
            {
              id: "apply",
              label: "Apply",
              icon: <Undo2 />,
              onSelect: () => void actions.apply(active, false),
            },
            {
              id: "pop",
              label: "Pop",
              icon: <ArrowDownToLine />,
              onSelect: () => void actions.apply(active, true),
            },
            {
              id: "drop",
              label: "Drop",
              icon: <Trash2 />,
              destructive: true,
              onSelect: () => void actions.drop(active),
            },
          ]}
        />
      )}
      {actions.dialog}
    </div>
  );
}
