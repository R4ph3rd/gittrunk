import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "@/design/components";
import type { RefsSnapshot } from "@/ipc/bindings";
import { queryKeys } from "@/ipc/queries";
import { useDndStore } from "@/stores/dnd";
import { requestOperation } from "../preview/useConfirmedOperation";
import type { ActionContext } from "./entries";
import { openRebaseEditor } from "./ops";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${text.length > 40 ? `${text.slice(0, 12)}…` : text}`);
  } catch {
    toast.error("Could not copy to the clipboard");
  }
}

/** Builds the side-effecting context for menu entries, reading HEAD from the refs cache. */
export function makeActionContext(client: QueryClient, repoId: string): ActionContext {
  return {
    repoId,
    head: client.getQueryData<RefsSnapshot>(queryKeys.refs(repoId))?.head ?? null,
    perform: (spec) => void requestOperation(client, spec),
    prompt: (request) => useDndStore.getState().setPrompt(request),
    copy: (text) => void copyText(text),
    openRebaseEditor: (base) => openRebaseEditor(repoId, base),
  };
}

/** Returns a factory that builds a fresh action context at the time a menu opens. */
export function useActionContext(repoId: string): () => ActionContext {
  const client = useQueryClient();
  return useCallback(() => makeActionContext(client, repoId), [client, repoId]);
}
