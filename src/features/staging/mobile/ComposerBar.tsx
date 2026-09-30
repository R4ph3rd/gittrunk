import { Button } from "@/design/components";
import { useRepoInfo } from "@/ipc/queries";
import { useDraft } from "@/stores/composer";
import { useNav } from "@/stores/nav";
import { canCommit, useCommit } from "./useCommit";

/**
 * Sticky bar at the bottom of the Changes tab: the draft summary (tap to open the composer)
 * and a Commit button with the staged count. With an empty summary Commit opens the composer.
 */
export function ComposerBar({ repoId, stagedCount }: { repoId: string; stagedCount: number }) {
  const nav = useNav();
  const draft = useDraft(repoId);
  const info = useRepoInfo(repoId);
  const hasHead = info.data ? info.data.head.kind !== "unborn" : false;
  const { submit, pending, sheet } = useCommit(repoId);
  const ready = canCommit(draft, stagedCount, hasHead);
  const openComposer = () => nav.push({ name: "compose" });

  return (
    <div
      role="group"
      aria-label="Commit"
      className="flex shrink-0 items-center gap-2 border-t border-border bg-surface-raised px-3 py-2"
    >
      <button
        type="button"
        aria-label="Commit message"
        onClick={openComposer}
        className="flex min-h-[var(--touch-target)] min-w-0 flex-1 items-center rounded-md border border-border bg-bg-subtle px-3 text-left text-base outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
      >
        <span className={draft.summary ? "truncate text-fg" : "truncate text-fg-subtle"}>
          {draft.summary || "Commit summary"}
        </span>
      </button>
      <Button
        variant="primary"
        disabled={pending || (stagedCount === 0 && !draft.amend)}
        loading={pending}
        onClick={ready ? submit : openComposer}
      >
        Commit
        <span data-testid="staged-count" className="font-mono">
          {stagedCount}
        </span>
      </Button>
      {sheet}
    </div>
  );
}
