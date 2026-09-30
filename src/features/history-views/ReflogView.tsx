import { LogIn, Locate } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { IconButton, Tooltip } from "@/design/components";
import { relativeDate, absoluteDate } from "@/features/graph/format";
import { ops } from "@/features/operations/actions/ops";
import { requestOperation } from "@/features/operations/preview/useConfirmedOperation";
import { useReflog } from "./queries";

const NULL_OID = /^0+$/;
const short = (oid: string) => (NULL_OID.test(oid) ? "-" : oid.slice(0, 7));

/** Reflog of one ref. Checkout goes through the shared dry-run and confirmation flow. */
export function ReflogView({
  repoId,
  refName,
  onReveal,
}: {
  repoId: string;
  refName: string;
  onReveal: (oid: string) => void;
}) {
  const reflog = useReflog(repoId, refName);
  const client = useQueryClient();

  if (reflog.isError) return <p className="p-3 text-sm text-danger">{reflog.error.message}</p>;
  if (!reflog.data) return <p className="p-3 text-sm text-fg-muted">Loading reflog…</p>;
  if (reflog.data.length === 0)
    return <p className="p-3 text-sm text-fg-muted">Reflog is empty.</p>;

  return (
    <div className="h-full overflow-auto">
      <table aria-label={`Reflog of ${refName}`} className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th className="px-3 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">New</th>
            <th className="px-2 py-1.5 font-medium">Old</th>
            <th className="px-2 py-1.5 font-medium">Message</th>
            <th className="px-2 py-1.5 font-medium">Committer</th>
            <th className="px-2 py-1.5 font-medium">Time</th>
            <th className="px-2 py-1.5 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {reflog.data.map((e) => (
            <tr key={e.index} className="border-t border-border hover:bg-surface-hover">
              <td className="px-3 py-1 font-mono text-xs text-fg-subtle">{e.index}</td>
              <td className="px-2 py-1 font-mono text-xs text-accent">{short(e.newOid)}</td>
              <td className="px-2 py-1 font-mono text-xs text-fg-muted">{short(e.oldOid)}</td>
              <td className="max-w-[28rem] truncate px-2 py-1" title={e.message}>
                {e.message}
              </td>
              <td className="px-2 py-1 text-fg-muted">{e.committer.name}</td>
              <td className="whitespace-nowrap px-2 py-1 text-fg-muted">
                <time title={absoluteDate(e.committer.time)}>{relativeDate(e.committer.time)}</time>
              </td>
              <td className="whitespace-nowrap px-2 py-1 text-right">
                <Tooltip content="Reveal in graph">
                  <IconButton
                    size="sm"
                    aria-label={`Reveal ${short(e.newOid)} in graph`}
                    onClick={() => onReveal(e.newOid)}
                  >
                    <Locate />
                  </IconButton>
                </Tooltip>
                <Tooltip content="Checkout this commit">
                  <IconButton
                    size="sm"
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
                </Tooltip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
