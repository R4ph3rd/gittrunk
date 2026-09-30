import { useRef, useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/design/components";
import { commands, type AiPayloadPreview, type AiRequest } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { useAiStore } from "@/stores/ai";
import { reportAiError, runText } from "./api";
import { PayloadPreview } from "./PayloadPreview";

interface Pending {
  request: AiRequest;
  preview: AiPayloadPreview;
}

/**
 * Runs a text AI request. The first use in a session shows the exact payload with
 * Send/Cancel; afterwards requests run directly. `start` resolves to the text, or
 * null when cancelled or failed (errors are already reported with a toast).
 * Render `dialog` somewhere in the component.
 */
export function usePreviewedRun(repoId: string) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((text: string | null) => void) | null>(null);

  const execute = async (request: AiRequest): Promise<string | null> => {
    setBusy(true);
    try {
      return await runText(repoId, request);
    } catch (e) {
      reportAiError(e);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const start = async (request: AiRequest): Promise<string | null> => {
    if (useAiStore.getState().previewAcked) return execute(request);
    setBusy(true);
    let preview: AiPayloadPreview;
    try {
      preview = await unwrap(commands.aiPayloadPreview(repoId, request));
    } catch (e) {
      reportAiError(e);
      return null;
    } finally {
      setBusy(false);
    }
    return new Promise((resolve) => {
      resolver.current = resolve;
      setPending({ request, preview });
    });
  };

  const finish = (text: string | null) => {
    resolver.current?.(text);
    resolver.current = null;
    setPending(null);
  };

  const send = async () => {
    if (!pending) return;
    useAiStore.getState().ackPreview();
    const { request } = pending;
    setPending(null);
    finish(await execute(request));
  };

  const dialog: ReactNode = (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && finish(null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Send this to the AI provider?</DialogTitle>
          <DialogDescription>
            This is exactly what will be sent. You will only be asked once per session.
          </DialogDescription>
        </DialogHeader>
        {pending ? <PayloadPreview preview={pending.preview} /> : null}
        <DialogFooter>
          <Button onClick={() => finish(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => void send()}>
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { start, busy, dialog };
}
