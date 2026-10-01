import { useLayout } from "@/app/layout/useLayout";
import { useNav } from "@/stores/nav";
import { openSettings } from "@/stores/settings";

/** Opens Settings > Integrations: a dialog on regular layouts, a page route on compact ones. */
export function useOpenIntegrations(): () => void {
  const { isCompact } = useLayout();
  const nav = useNav();
  return () => {
    if (isCompact) nav.push({ name: "settings", section: "integrations" });
    else openSettings("integrations");
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const commentsLabel = (n: number) => `${n} ${n === 1 ? "comment" : "comments"}`;
