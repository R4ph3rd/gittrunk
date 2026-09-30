import { X } from "lucide-react";
import { IconButton, Spinner } from "@/design/components";
import { cancelOp } from "./ops";
import { useOpsStore, type RunningOp } from "./store";

function OpRow({ op }: { op: RunningOp }) {
  const detail = op.message ?? op.phase;
  return (
    <div className="flex items-center gap-2" data-testid="op-row">
      <Spinner label={`${op.label} in progress`} />
      <span className="text-fg-muted">{op.label}</span>
      <span className="max-w-64 truncate text-fg-subtle">
        {detail}
        {op.percent !== null ? ` ${Math.round(op.percent)}%` : ""}
      </span>
      {op.percent !== null && (
        <div
          role="progressbar"
          aria-label={`${op.label} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(op.percent)}
          className="h-1 w-24 overflow-hidden rounded-sm bg-border"
        >
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, op.percent)}%` }} />
        </div>
      )}
      <IconButton
        aria-label={`Cancel ${op.label}`}
        className="size-5"
        onClick={() => void cancelOp(op.id)}
      >
        <X />
      </IconButton>
    </div>
  );
}

/** Compact progress for running operations of the active repo (and repo-less ones such as clone). */
export function OpIndicator({ repoId }: { repoId: string | null }) {
  const ops = useOpsStore((s) => s.ops);
  const shown = Object.values(ops).filter((o) => o.repoId === null || o.repoId === repoId);
  if (shown.length === 0) return null;
  return (
    <div className="flex items-center gap-4" role="group" aria-label="Running operations">
      {shown.map((op) => (
        <OpRow key={op.id} op={op} />
      ))}
    </div>
  );
}
