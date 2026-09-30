import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LogIn } from "lucide-react";
import type { RouteScreenProps } from "@/app/layout/registry";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import { IconButton, ListRow } from "@/design/components";
import { relativeDate } from "@/features/graph/format";
import { ops } from "@/features/operations/actions/ops";
import { requestOperation } from "@/features/operations/preview/useConfirmedOperation";
import { useNav } from "@/stores/nav";
import { useFileHistory, useReflog } from "./queries";

const NULL_OID = /^0+$/;
const short = (oid: string) => (NULL_OID.test(oid) ? "-" : oid.slice(0, 7));

/** Commits touching one file, as a plain list page (phone layout). */
export function FileHistoryPage({ repoId, route }: RouteScreenProps<"fileHistory">) {
  const nav = useNav();
  const history = useFileHistory(repoId, route.path);
  const entries = history.data ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <ShellAppBar repoId={repoId} back title="File history" subtitle={route.path} />
      <div data-scroll-root="" className="min-h-0 flex-1 overflow-y-auto">
        {history.isError && <p className="p-3 text-sm text-danger">{history.error.message}</p>}
        {!history.data && !history.isError && (
          <p className="p-3 text-sm text-fg-muted">Loading history…</p>
        )}
        {history.data && entries.length === 0 && (
          <p className="p-3 text-sm text-fg-muted">No commits touch this file.</p>
        )}
        <ul aria-label={`History of ${route.path}`}>
          {entries.map((e) => (
            <li key={e.commit.oid}>
              <ListRow
                title={e.commit.summary}
                subtitle={`${e.commit.shortOid} · ${e.commit.authorName} · ${relativeDate(e.commit.authorTime)}${e.path !== route.path ? ` · as ${e.path}` : ""}`}
                chevron
                onClick={() => nav.push({ name: "commitFile", oid: e.commit.oid, path: e.path })}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Reflog of one ref (HEAD when `ref` is null) as a plain list page (phone layout). */
export function ReflogPage({ repoId, route }: RouteScreenProps<"reflog">) {
  const nav = useNav();
  const client = useQueryClient();
  const refName = route.ref ?? "HEAD";
  const reflog = useReflog(repoId, refName);
  const entries = reflog.data ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <ShellAppBar
        repoId={repoId}
        back
        title="Reflog"
        subtitle={refName.replace(/^refs\/(heads|remotes)\//, "")}
      />
      <div data-scroll-root="" className="min-h-0 flex-1 overflow-y-auto">
        {reflog.isError && <p className="p-3 text-sm text-danger">{reflog.error.message}</p>}
        {!reflog.data && !reflog.isError && (
          <p className="p-3 text-sm text-fg-muted">Loading reflog…</p>
        )}
        {reflog.data && entries.length === 0 && (
          <p className="p-3 text-sm text-fg-muted">Reflog is empty.</p>
        )}
        <ul aria-label={`Reflog of ${refName}`}>
          {entries.map((e) => (
            <li key={e.index}>
              <ListRow
                title={e.message}
                subtitle={`${short(e.newOid)} · ${e.committer.name} · ${relativeDate(e.committer.time)}`}
                trailing={
                  <>
                    <IconButton
                      aria-label={`Open ${short(e.newOid)}`}
                      onClick={() => nav.push({ name: "commit", oid: e.newOid })}
                    >
                      <ChevronRight />
                    </IconButton>
                    <IconButton
                      aria-label={`Checkout ${short(e.newOid)}`}
                      onClick={() =>
                        void requestOperation(
                          client,
                          ops.checkout(repoId, { kind: "commit", oid: e.newOid }, short(e.newOid)),
                        )
                      }
                    >
                      <LogIn />
                    </IconButton>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
