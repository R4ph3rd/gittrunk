import { Badge } from "@/design/components";
import type { AiPlan, OpPreview } from "@/ipc/bindings";

const short = (oid: string | null) => (oid ? oid.slice(0, 7) : "none");

/** Simple list rendering of the combined dry-run preview. */
export function PreviewList({ preview }: { preview: OpPreview }) {
  return (
    <div className="flex flex-col gap-2 text-base">
      <p className="text-fg">{preview.summary}</p>
      {preview.refUpdates.length > 0 ? (
        <ul aria-label="Ref updates" className="flex flex-col gap-0.5 font-mono text-sm">
          {preview.refUpdates.map((u, i) => (
            <li key={`${u.name}-${i}`} className="text-fg-muted">
              {u.name}: {short(u.from)} to {short(u.to)}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.commitsCreated > 0 ? (
        <p className="text-sm text-fg-muted">
          {preview.commitsCreated} commit{preview.commitsCreated === 1 ? "" : "s"} will be created
        </p>
      ) : null}
      {preview.commitsDropped.length > 0 ? (
        <div className="text-sm text-fg-muted">
          Dropped commits:
          <ul className="font-mono">
            {preview.commitsDropped.map((c) => (
              <li key={c.oid}>
                {c.shortOid} {c.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.predictedConflicts.length > 0 ? (
        <div className="text-sm text-danger">
          Predicted conflicts:
          <ul className="font-mono">
            {preview.predictedConflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.warnings.map((w) => (
        <p key={w} className="text-sm text-warning">
          {w}
        </p>
      ))}
    </div>
  );
}

/** Explanation, numbered steps and the combined preview of a plan. */
export function PlanView({ plan }: { plan: AiPlan }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-base text-fg">{plan.explanation}</p>
      {plan.steps.length === 0 ? (
        <p className="text-base text-fg-muted">The assistant proposed no steps.</p>
      ) : (
        <ol aria-label="Plan steps" className="flex list-decimal flex-col gap-1.5 pl-5">
          {plan.steps.map((s, i) => (
            <li key={i} className="text-base text-fg">
              {s.description} <Badge variant="neutral">{s.command.kind}</Badge>
            </li>
          ))}
        </ol>
      )}
      {plan.steps.length > 0 ? (
        <div className="rounded-md border border-border bg-bg-subtle p-2">
          <PreviewList preview={plan.preview} />
        </div>
      ) : null}
    </div>
  );
}
