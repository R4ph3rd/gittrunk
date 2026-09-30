import { cn } from "@/lib/cn";
import { useRepoStore } from "@/stores/repo";
import { ROW_HEIGHT } from "./layout";
import { useWipCount } from "./useWipCount";

/**
 * Pseudo-row above the graph for uncommitted changes. It sits outside the virtualized list, so
 * row indices, scroll offsets and the canvas are unaffected. Renders nothing when clean.
 */
export function WipRow({ repoId, gutter }: { repoId: string; gutter: number }) {
  const { staged, unstaged } = useWipCount(repoId);
  const selected = useRepoStore((s) => s.selection[repoId]?.kind === "wip");
  const selectWip = useRepoStore((s) => s.selectWip);
  if (staged + unstaged === 0) return null;

  return (
    <button
      type="button"
      data-testid="wip-row"
      aria-pressed={selected}
      aria-label={`Working copy: ${staged} staged, ${unstaged} unstaged`}
      onClick={() => selectWip(repoId)}
      className={cn(
        "flex w-full shrink-0 items-center gap-3 border-b border-border pr-3 text-left text-sm",
        selected ? "bg-accent-muted" : "hover:bg-surface-hover",
      )}
      style={{ height: ROW_HEIGHT, paddingLeft: gutter }}
    >
      <span className="font-mono font-semibold text-accent">{"// WIP"}</span>
      <span className="text-fg-muted">
        {staged} staged · {unstaged} unstaged
      </span>
    </button>
  );
}
