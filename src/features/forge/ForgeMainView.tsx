import type { ForgeCenterView } from "@/stores/workspace";

/** Replaced by the forge package (UI-FORGE). */
export function ForgeMainView({ repoId, view }: { repoId: string; view: ForgeCenterView }) {
  void repoId;
  return <div data-testid="forge-main-view" data-view={view.kind} />;
}
