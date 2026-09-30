import { useEffect, type ComponentType, type DependencyList } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import type { Platform } from "../shortcuts";

/** What a command can see when deciding whether it applies (`when`) and when it runs. */
export interface CommandContext {
  /** Id of the active repository tab, or null on the welcome screen. */
  repoId: string | null;
  queryClient: QueryClient;
  platform: Platform;
  openPalette: () => void;
  openShortcutsHelp: () => void;
}

export interface Command {
  /** Stable unique id, dotted by feature: `repo.open`, `graph.focusSearch`. */
  id: string;
  title: string;
  /** Palette heading, e.g. "Repository", "Graph", "View". */
  group: string;
  icon?: ComponentType<{ className?: string }>;
  /** `mod+k`, `mod+shift+p`, `g b` (sequence). A list registers several; the first is displayed. */
  shortcut?: string | string[];
  /** Fire the shortcut even while typing in an input (use for `mod+enter`, `mod+k`). */
  allowInInput?: boolean;
  /** Extra palette search terms. */
  keywords?: string[];
  /** Hide the command (palette and shortcut) unless this returns true. */
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}

/** The shortcut(s) a command responds to once user overrides are applied. */
export function effectiveShortcut(
  command: Pick<Command, "id" | "shortcut">,
  overrides: Record<string, string | null>,
): string | string[] | undefined {
  if (Object.prototype.hasOwnProperty.call(overrides, command.id)) {
    return overrides[command.id] ?? undefined;
  }
  return command.shortcut;
}

/** Replaces all user keybinding overrides (`null` unbinds). The matcher and displays follow live. */
export function setShortcutOverrides(overrides: Record<string, string | null>) {
  useCommandStore.getState().setShortcutOverrides(overrides);
}

interface CommandStore {
  commands: Record<string, Command>;
  paletteOpen: boolean;
  helpOpen: boolean;
  /** Most recently run command ids, newest first. */
  recent: string[];
  /** User keybinding overrides by command id: a shortcut string replaces the default, null unbinds. */
  shortcutOverrides: Record<string, string | null>;
  register: (commands: Command[]) => () => void;
  setShortcutOverrides: (overrides: Record<string, string | null>) => void;
  setPaletteOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  markUsed: (id: string) => void;
}

const RECENT_KEY = "gittrunk.commandRecents";
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable */
  }
}

export const useCommandStore = create<CommandStore>((set) => ({
  commands: {},
  paletteOpen: false,
  helpOpen: false,
  recent: loadRecent(),
  shortcutOverrides: {},
  setShortcutOverrides: (shortcutOverrides) => set({ shortcutOverrides }),
  register: (list) => {
    set((s) => {
      const commands = { ...s.commands };
      for (const c of list) commands[c.id] = c;
      return { commands };
    });
    return () =>
      set((s) => {
        const commands = { ...s.commands };
        // Only remove entries this call registered (a later registration may have replaced them).
        for (const c of list) if (commands[c.id] === c) delete commands[c.id];
        return { commands };
      });
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  markUsed: (id) =>
    set((s) => {
      const recent = [id, ...s.recent.filter((r) => r !== id)].slice(0, RECENT_MAX);
      saveRecent(recent);
      return { recent };
    }),
}));

/**
 * Registers commands while the calling component is mounted. Re-registers when `deps` change,
 * so include everything `run`/`when` close over (like `useEffect` deps).
 */
export function useRegisterCommands(commands: Command[], deps: DependencyList = []) {
  const register = useCommandStore((s) => s.register);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's dependency list
  useEffect(() => register(commands), [register, ...deps]);
}
