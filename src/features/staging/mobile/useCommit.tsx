import { useCallback, useState, type ReactNode } from "react";
import { usePlatform } from "@/app/platform";
import { useCommitCreate, useGitIdentity } from "@/ipc/queries";
import { useComposerStore, useDraft, type Draft } from "@/stores/composer";
import { buildMessage } from "../message";
import { errorMessage, useOutcomeToast } from "../ops";
import { IdentitySheet } from "./IdentitySheet";

/** True when the draft may be committed (same rule as the desktop `CommitBox`). */
export function canCommit(draft: Draft, stagedCount: number, hasHead: boolean): boolean {
  if (draft.summary.trim().length === 0) return false;
  if (draft.amend) return hasHead;
  return stagedCount > 0;
}

/**
 * Commits the draft of `repoId`. Where the platform has no git CLI and no identity is
 * configured, opens the `IdentitySheet` first and continues the commit once it was saved.
 * Render `sheet` next to the button that calls `submit`.
 */
export function useCommit(repoId: string, opts: { onDone?: () => void } = {}) {
  const draft = useDraft(repoId);
  const commit = useCommitCreate(repoId);
  const notify = useOutcomeToast(repoId);
  const platform = usePlatform();
  const identity = useGitIdentity();
  const [identityOpen, setIdentityOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { onDone } = opts;

  const needsIdentity =
    !platform.hasGitCli &&
    identity.data !== undefined &&
    !(identity.data.name && identity.data.email);

  const { mutateAsync } = commit;
  const run = useCallback(() => {
    const d = useComposerStore.getState().drafts[repoId] ?? draft;
    setError(null);
    return mutateAsync({
      message: buildMessage(d.summary, d.body),
      amend: d.amend,
      signOff: d.signOff,
      allowEmpty: false,
    })
      .then((outcome) => {
        useComposerStore.getState().clear(repoId);
        notify(outcome, d.amend ? "Commit amended" : "Committed");
        onDone?.();
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [mutateAsync, draft, notify, onDone, repoId]);

  const submit = () => {
    if (needsIdentity) setIdentityOpen(true);
    else void run();
  };

  const sheet: ReactNode = identityOpen ? (
    <IdentitySheet open onOpenChange={setIdentityOpen} onSaved={() => void run()} />
  ) : null;

  return { submit, pending: commit.isPending, error, sheet, needsIdentity };
}
