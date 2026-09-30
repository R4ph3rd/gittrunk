import { Badge } from "@/design/components";
import type { AiPayloadPreview } from "@/ipc/bindings";

/** The exact text that will be sent to the provider, with size and file list. */
export function PayloadPreview({ preview }: { preview: AiPayloadPreview }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        <span>{preview.bytes.toLocaleString()} bytes</span>
        {preview.files.length > 0 ? (
          <span>
            {preview.files.length} file{preview.files.length === 1 ? "" : "s"}
          </span>
        ) : null}
        {preview.truncated ? <Badge variant="warning">truncated</Badge> : null}
      </div>
      <pre
        aria-label="Payload sent to the AI provider"
        className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg-subtle p-2 font-mono text-sm text-fg"
      >
        {preview.content}
      </pre>
    </div>
  );
}
