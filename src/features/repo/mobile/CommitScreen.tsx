import { useState } from "react";
import { EllipsisVertical } from "lucide-react";
import type { RouteScreenProps } from "@/app/layout/registry";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import { usePlatform } from "@/app/platform";
import { Button, IconButton, ListRow } from "@/design/components";
import { AiSummaryButton } from "@/features/ai";
import { CommitComments } from "@/features/forge/CommitComments";
import { absoluteDate, relativeDate } from "@/features/graph/format";
import { RefBadge } from "@/features/graph/GraphRowView";
import { openActionMenu } from "@/features/operations/actions/openMenu";
import { useActionContext } from "@/features/operations/actions/useActionContext";
import { useAiEnabled, useCommitDetails } from "@/ipc/queries";
import { useNav } from "@/stores/nav";

const COLLAPSED_LINES = 6;

/** Commit detail page: subject, body, author, parents, AI summary and the changed files. */
export function CommitScreen({ repoId, route }: RouteScreenProps<"commit">) {
  usePlatform();
  const nav = useNav();
  const details = useCommitDetails(repoId, route.oid);
  const makeContext = useActionContext(repoId);
  const aiEnabled = useAiEnabled();
  const [expanded, setExpanded] = useState(false);
  const d = details.data;
  const bodyLines = d?.body ? d.body.split("\n").length : 0;
  const collapsible = bodyLines > COLLAPSED_LINES;
  const adds = d?.files.reduce((n, f) => n + f.additions, 0) ?? 0;
  const dels = d?.files.reduce((n, f) => n + f.deletions, 0) ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <ShellAppBar
        repoId={repoId}
        back
        title={route.oid.slice(0, 7)}
        actions={
          <IconButton
            aria-label="Commit actions"
            onClick={() =>
              openActionMenu(
                0,
                0,
                { kind: "commit", oid: route.oid, shortOid: route.oid.slice(0, 7) },
                makeContext(),
              )
            }
          >
            <EllipsisVertical />
          </IconButton>
        }
      />
      <div data-scroll-root="" className="min-h-0 flex-1 overflow-y-auto">
        {details.isError && <p className="p-4 text-sm text-danger">{details.error.message}</p>}
        {details.isPending && !details.isError && (
          <p className="p-4 text-sm text-fg-muted">Loading…</p>
        )}
        {d && (
          <>
            <div className="flex flex-col gap-2 border-b border-border p-3">
              <h2 className="text-lg font-semibold leading-snug">{d.summary}</h2>
              {d.body && (
                <div>
                  <pre
                    className="whitespace-pre-wrap font-sans text-base text-fg-muted"
                    style={
                      collapsible && !expanded
                        ? {
                            display: "-webkit-box",
                            WebkitLineClamp: COLLAPSED_LINES,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }
                        : undefined
                    }
                  >
                    {d.body}
                  </pre>
                  {collapsible && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={expanded}
                      onClick={() => setExpanded((e) => !e)}
                    >
                      {expanded ? "Show less" : "Show more"}
                    </Button>
                  )}
                </div>
              )}
              {d.refs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {d.refs.map((r) => (
                    <RefBadge key={r.fullName} label={r} />
                  ))}
                </div>
              )}
              <p className="text-base">
                {d.author.name} <span className="text-fg-muted">&lt;{d.author.email}&gt;</span>
                <span className="text-fg-muted" title={absoluteDate(d.author.time)}>
                  {" "}
                  · {relativeDate(d.author.time)}
                </span>
              </p>
              {d.parents.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-fg-subtle">
                  parents:
                  {d.parents.map((p) => (
                    <Button
                      key={p}
                      variant="outline"
                      size="sm"
                      className="font-mono text-accent"
                      aria-label={`Parent ${p.slice(0, 7)}`}
                      onClick={() => nav.push({ name: "commit", oid: p })}
                    >
                      {p.slice(0, 7)}
                    </Button>
                  ))}
                </div>
              )}
              {aiEnabled && (
                <div>
                  <AiSummaryButton repoId={repoId} target={{ kind: "commit", oid: route.oid }} />
                </div>
              )}
            </div>
            <h3 className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {d.files.length} changed files <span className="text-success">+{adds}</span>{" "}
              <span className="text-danger">-{dels}</span>
            </h3>
            <ul aria-label="Changed files">
              {d.files.map((f) => (
                <li key={f.path}>
                  <ListRow
                    title={<span className="font-mono text-sm">{f.path}</span>}
                    leading={
                      <span className="w-4 font-mono text-xs">
                        {f.status.charAt(0).toUpperCase()}
                      </span>
                    }
                    trailing={
                      f.binary ? null : (
                        <span className="font-mono text-xs">
                          <span className="text-success">+{f.additions}</span>{" "}
                          <span className="text-danger">-{f.deletions}</span>
                        </span>
                      )
                    }
                    chevron
                    onClick={() => nav.push({ name: "commitFile", oid: route.oid, path: f.path })}
                  />
                </li>
              ))}
            </ul>
            {/* Brings its own collapsible "Comments (n)" header; renders nothing without a forge. */}
            <CommitComments repoId={repoId} oid={route.oid} />
          </>
        )}
      </div>
    </div>
  );
}
