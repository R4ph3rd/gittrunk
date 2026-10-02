import { useCommandStore } from "@/app/commands";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import type { RouteScreenProps } from "@/app/layout/registry";
import { ListRow } from "@/design/components";
import { Integrations } from "@/features/forge/Integrations";
import { usePlatform } from "@/app/platform";
import { useNav } from "@/stores/nav";
import { AI_SETTINGS_COMMAND, Ai, General, Git } from "./SettingsDialog";
import { SshKeysSection } from "./SshKeysSection";

type Section = "general" | "git" | "ai" | "integrations" | "ssh";

const LABELS: Record<Section, string> = {
  general: "General",
  git: "Git",
  ai: "AI",
  integrations: "Integrations",
  ssh: "SSH keys",
};

/**
 * Settings as pages for compact layouts: a section list, and one page per section reusing the
 * dialog's section components. The keyboard section is not offered on touch layouts.
 */
export function SettingsPage({ repoId, route }: RouteScreenProps<"settings">) {
  const nav = useNav();
  const hasAi = useCommandStore((s) => AI_SETTINGS_COMMAND in s.commands);
  const { supportsSsh } = usePlatform();
  const sections = (["general", "git", "ai", "integrations", "ssh"] as const).filter(
    (s) => (s !== "ai" || hasAi) && (s !== "ssh" || supportsSsh),
  );
  // A route to a hidden section (SSH on Android) falls back to the section list.
  const section =
    route.section && sections.some((s) => s === route.section) ? route.section : undefined;

  if (!section) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ShellAppBar repoId={repoId} back title="Settings" />
        <nav
          aria-label="Settings sections"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface"
        >
          {sections.map((s) => (
            <ListRow
              key={s}
              title={LABELS[s]}
              chevron
              onClick={() => nav.push({ name: "settings", section: s })}
            />
          ))}
        </nav>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar repoId={repoId} back title={LABELS[section]} subtitle="Settings" />
      <div
        role="region"
        aria-label={LABELS[section]}
        className="min-h-0 flex-1 overflow-y-auto bg-surface px-4 pb-4"
      >
        {section === "general" ? <General /> : null}
        {section === "git" ? <Git /> : null}
        {section === "ai" ? <Ai /> : null}
        {section === "integrations" ? <Integrations /> : null}
        {section === "ssh" ? <SshKeysSection /> : null}
      </div>
    </div>
  );
}
