import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useLayout } from "@/app/layout/useLayout";
import { Badge } from "@/design/components";
import type { AiPayloadPreview } from "@/ipc/bindings";

/**
 * The exact text that will be sent to the provider, with size and file list. On compact layouts
 * the text is a collapsible section (collapsed by default) so the Send button stays in view.
 */
export function PayloadPreview({ preview }: { preview: AiPayloadPreview }) {
  const { isCompact } = useLayout();
  const [open, setOpen] = useState(false);
  const showText = !isCompact || open;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        {isCompact ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex min-h-[var(--touch-target)] items-center gap-1 rounded-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {open ? "Hide payload" : "Show payload"}
          </button>
        ) : null}
        <span>{preview.bytes.toLocaleString()} bytes</span>
        {preview.files.length > 0 ? (
          <span>
            {preview.files.length} file{preview.files.length === 1 ? "" : "s"}
          </span>
        ) : null}
        {preview.truncated ? <Badge variant="warning">truncated</Badge> : null}
      </div>
      {showText ? (
        <pre
          aria-label="Payload sent to the AI provider"
          className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg-subtle p-2 font-mono text-sm text-fg"
        >
          {preview.content}
        </pre>
      ) : null}
    </div>
  );
}
