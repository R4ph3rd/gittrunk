import { Sparkles } from "lucide-react";
import { useState } from "react";
import { IconButton, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/design/components";
import type { SummaryTarget } from "@/ipc/bindings";
import { usePreviewedRun } from "./usePreviewedRun";

/** Summarizes a commit or branch and shows the result in a popover. */
export function AiSummaryButton({
  repoId,
  target,
  label = "Summarize with AI",
}: {
  repoId: string;
  target: SummaryTarget;
  label?: string;
}) {
  const { start, busy, dialog } = usePreviewedRun(repoId);
  const [summary, setSummary] = useState<string | null>(null);
  return (
    <>
      <Popover open={summary !== null} onOpenChange={(open) => !open && setSummary(null)}>
        <Tooltip content={label}>
          <PopoverTrigger asChild>
            <IconButton
              aria-label={label}
              size="sm"
              loading={busy}
              onClick={async (e) => {
                e.preventDefault();
                setSummary(await start({ kind: "summarize", target }));
              }}
            >
              <Sparkles />
            </IconButton>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent className="w-80">
          <p className="mb-1 text-sm font-medium text-fg-muted">AI summary</p>
          <p className="whitespace-pre-wrap text-base text-fg">{summary}</p>
        </PopoverContent>
      </Popover>
      {dialog}
    </>
  );
}
