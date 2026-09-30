import { toast } from "@/design/components";
import { commands, type AiRequest, type AiSettings } from "@/ipc/bindings";
import { isIpcError, unwrap } from "@/ipc/client";
import { openAiSettings } from "@/stores/ai";

export const DEFAULT_MODELS = {
  anthropic: "claude-haiku-4-5",
  openAiCompatible: "gpt-4o-mini",
} as const;

export const PROVIDER_NAMES = {
  anthropic: "Anthropic",
  openAiCompatible: "your OpenAI-compatible provider",
} as const;

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const isAiDisabled = (e: unknown) => isIpcError(e) && e.kind === "aiDisabled";

/** Runs a text-producing request (everything except plans) and returns the text. */
export async function runText(repoId: string, request: AiRequest): Promise<string> {
  const response = await unwrap(commands.aiRun(repoId, request));
  if (response.kind !== "text") throw new Error("Unexpected response from the AI service");
  return response.text;
}

/**
 * Suggests a resolved file for a conflicted path. Matches the conflict resolver's
 * `suggest?: (file) => Promise<string>` extension point:
 * `suggest={(f) => suggestConflictResolution(repoId, f.path)}`.
 */
export function suggestConflictResolution(repoId: string, path: string): Promise<string> {
  return runText(repoId, { kind: "conflictSuggestion", path });
}

export function loadAiSettings(): Promise<AiSettings> {
  return unwrap(commands.aiSettingsGet());
}

/** Error toast; when AI is off or unconfigured it offers a shortcut to AI settings. */
export function reportAiError(e: unknown) {
  if (isAiDisabled(e)) {
    toast.error(errorMessage(e), { action: { label: "AI settings", onClick: openAiSettings } });
  } else {
    toast.error(errorMessage(e));
  }
}
