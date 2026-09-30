import { MessageSquareText, Sparkles } from "lucide-react";
import { useRegisterCommands } from "@/app/commands";
import { openAiSettings, openAskAi } from "@/stores/ai";
import { AiPrDescriptionHost } from "./AiPrDescriptionDialog";
import { AiSettingsDialog } from "./AiSettingsDialog";
import { AskAiDialog } from "./AskAiDialog";

/**
 * Mount once inside `QueryClientProvider` and next to `CommandHost`. Registers the
 * "AI settings" (`ai.settings`) and "Ask AI..." (`ai.ask`, `mod+shift+i`) commands and
 * renders the AI dialogs.
 */
export function AiHost() {
  useRegisterCommands([
    {
      id: "ai.settings",
      title: "AI settings",
      group: "AI",
      icon: Sparkles,
      keywords: ["ai", "model", "provider", "api key", "anthropic", "openai"],
      run: () => openAiSettings(),
    },
    {
      id: "ai.ask",
      title: "Ask AI…",
      group: "AI",
      icon: MessageSquareText,
      shortcut: "mod+shift+i",
      keywords: ["assistant", "natural language", "plan", "git"],
      when: (ctx) => ctx.repoId !== null,
      run: (ctx) => {
        if (ctx.repoId) openAskAi(ctx.repoId);
      },
    },
  ]);
  return (
    <>
      <AiSettingsDialog />
      <AskAiDialog />
      <AiPrDescriptionHost />
    </>
  );
}
