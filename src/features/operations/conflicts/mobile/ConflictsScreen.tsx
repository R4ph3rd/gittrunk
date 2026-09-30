import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import type { RouteScreenProps } from "@/app/layout/registry";
import { Badge, Button, EmptyState, ListRow } from "@/design/components";
import { useRepoInfo, useStatus } from "@/ipc/queries";
import { useNav } from "@/stores/nav";
import { useOperationsStore } from "@/stores/operations";
import { isSequencerState, useSequencerActions } from "../../sequencer/actions";

/**
 * Conflicted files of the operation in progress. Files stay listed (as resolved) after they
 * leave the backend's conflicted set, so progress is visible; Continue unlocks at zero left.
 */
export function ConflictsScreen({ repoId }: RouteScreenProps<"conflicts">) {
  const nav = useNav();
  const status = useStatus(repoId);
  const info = useRepoInfo(repoId);
  const { run, pending } = useSequencerActions(repoId);
  const setAbortConfirm = useOperationsStore((s) => s.setAbortConfirm);

  const open = status.data?.conflicted.map((f) => f.path) ?? [];
  const [seen, setSeen] = useState<string[]>(open);
  // Files stay listed once seen (adjusting state while rendering, not in an effect).
  const missing = open.filter((p) => !seen.includes(p));
  if (missing.length) setSeen([...seen, ...missing]);

  const state = info.data?.state ?? "clean";
  const sequencer = isSequencerState(state);
  // The operation finished (continued or aborted): leave the resolver.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (state !== "clean") wasBusy.current = true;
    else if (wasBusy.current && info.data) nav.pop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, info.data]);
  const left = open.length;
  const all = seen.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar
        repoId={repoId}
        back
        title="Resolve conflicts"
        subtitle={left === 0 ? "All resolved" : `${left} left`}
      />
      <div data-scroll-root="" className="min-h-0 flex-1 overflow-y-auto bg-surface">
        {all === 0 ? (
          <EmptyState
            className="m-3"
            icon={<CheckCircle2 />}
            title="No conflicts"
            description="There is nothing to resolve."
          />
        ) : (
          <ul aria-label="Conflicted files">
            {seen.map((path) => {
              const resolved = !open.includes(path);
              return (
                <li key={path}>
                  <ListRow
                    title={<span className="font-mono text-sm">{path}</span>}
                    trailing={
                      <Badge variant={resolved ? "success" : "danger"}>
                        {resolved ? "resolved" : "conflict"}
                      </Badge>
                    }
                    chevron={!resolved}
                    disabled={resolved}
                    onClick={() => nav.push({ name: "conflict", path })}
                    aria-label={`${path} ${resolved ? "resolved" : "conflicted"}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {sequencer && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface-raised px-3 py-2">
          <Button variant="danger" disabled={pending} onClick={() => setAbortConfirm(repoId, true)}>
            Abort
          </Button>
          <Button
            variant="primary"
            className="ml-auto"
            disabled={pending || left > 0}
            loading={pending}
            onClick={() => void run("continue")}
          >
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}
