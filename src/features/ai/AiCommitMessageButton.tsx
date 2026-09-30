import { Sparkles } from "lucide-react";
import { IconButton, Tooltip } from "@/design/components";
import { usePreviewedRun } from "./usePreviewedRun";

/**
 * Sparkle button that drafts a commit message from the staged diff. The first use per
 * session shows the exact payload for confirmation; `onResult` receives the message text.
 */
export function AiCommitMessageButton({
  repoId,
  onResult,
  disabled,
  disabledReason,
}: {
  repoId: string;
  onResult: (text: string) => void;
  disabled?: boolean;
  /** Shown as the tooltip while disabled (for example "Enable AI in settings"). */
  disabledReason?: string;
}) {
  const { start, busy, dialog } = usePreviewedRun(repoId);
  return (
    <>
      <Tooltip
        content={disabled && disabledReason ? disabledReason : "Draft commit message with AI"}
      >
        <span className="inline-flex">
          <IconButton
            aria-label="Generate commit message with AI"
            size="sm"
            loading={busy}
            disabled={disabled}
            onClick={async () => {
              const text = await start({ kind: "commitMessage" });
              if (text) onResult(text);
            }}
          >
            <Sparkles />
          </IconButton>
        </span>
      </Tooltip>
      {dialog}
    </>
  );
}
