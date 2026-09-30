import { useEffect } from "react";
import { Settings } from "lucide-react";
import { useRegisterCommands } from "@/app/commands";
import { useTheme } from "@/design/theme";
import { updateSettings, useSettingsStore } from "@/stores/settings";
import { SettingsDialog } from "./SettingsDialog";

/** ThemeProvider is optional so the host also works without it (tests). */
function useOptionalTheme() {
  try {
    return useTheme();
  } catch {
    return null;
  }
}

/**
 * Mount once inside `ThemeProvider`, `QueryClientProvider` and next to `CommandHost`.
 * Loads settings and keybindings, keeps the theme in sync with backend settings in both
 * directions, registers the "Settings" command (`mod+,`) and renders the settings dialog.
 */
export function SettingsHost() {
  const theme = useOptionalTheme();
  const settingsTheme = useSettingsStore((s) => s.settings?.theme);
  const setTheme = theme?.setTheme;
  const current = theme?.theme;

  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  // Settings -> ThemeProvider (initial load, dialog changes, rollbacks).
  useEffect(() => {
    if (settingsTheme && setTheme) setTheme(settingsTheme);
  }, [settingsTheme, setTheme]);

  // ThemeProvider -> settings (the "Toggle theme" command).
  useEffect(() => {
    const saved = useSettingsStore.getState().settings?.theme;
    if (saved && current && current !== saved) void updateSettings({ theme: current });
  }, [current]);

  useRegisterCommands([
    {
      id: "settings.open",
      title: "Settings",
      group: "View",
      icon: Settings,
      shortcut: "mod+,",
      keywords: ["preferences", "options", "configure"],
      run: () => useSettingsStore.getState().openDialog(),
    },
  ]);

  return <SettingsDialog />;
}
