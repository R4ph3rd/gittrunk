import { create } from "zustand";
import { toast } from "@/design/components/Toaster";
import { setShortcutOverrides } from "@/app/commands/registry";
import { commands, type AppSettings, type Keybinding } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";

export type SectionId = "general" | "git" | "keyboard" | "ai" | "integrations" | "ssh" | "about";

/** Used until the backend answers, and by getters when settings failed to load. */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  gitPath: null,
  pullStrategy: "merge",
  confirmDestructive: true,
  graphOrder: "topo",
  diffContextLines: 3,
  avatars: "github",
  backdrop: true,
  workspaces: [],
};

export type UpdateResult = { ok: true } | { ok: false; message: string };
export type Overrides = Record<string, string | null>;

interface SettingsState {
  settings: AppSettings | null;
  overrides: Overrides;
  open: boolean;
  section: SectionId;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<UpdateResult>;
  saveOverrides: (next: Overrides) => Promise<UpdateResult>;
  openDialog: (section?: SectionId) => void;
  closeDialog: () => void;
  setSection: (section: SectionId) => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Backend stores unbound as an empty `keys` string; the registry uses null. */
export function toOverrides(list: Keybinding[]): Overrides {
  const out: Overrides = {};
  for (const b of list) out[b.action] = b.keys === "" ? null : b.keys;
  return out;
}

export function fromOverrides(o: Overrides): Keybinding[] {
  return Object.entries(o).map(([action, keys]) => ({ action, keys: keys ?? "" }));
}

const LEGACY_PULL_KEY = "gittrunk.pullStrategy";

/**
 * The pull default used to live in localStorage. Carry it over once, and only when the
 * backend still holds the default, then drop the old key.
 */
export async function migrateLegacyPullStrategy(
  loaded: AppSettings,
  update: (patch: Partial<AppSettings>) => Promise<UpdateResult>,
): Promise<void> {
  try {
    const legacy = window.localStorage.getItem(LEGACY_PULL_KEY);
    if (legacy === null) return;
    const valid = legacy === "rebase" || legacy === "ffOnly";
    if (valid && loaded.pullStrategy === DEFAULT_SETTINGS.pullStrategy) {
      const result = await update({ pullStrategy: legacy });
      if (!result.ok) return; // keep the key so the next launch retries
    }
    window.localStorage.removeItem(LEGACY_PULL_KEY);
  } catch {
    /* storage unavailable */
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  overrides: {},
  open: false,
  section: "general",

  load: async () => {
    const [s, k] = await Promise.allSettled([
      unwrap(commands.settingsGet()),
      unwrap(commands.keybindingsGet()),
    ]);
    if (s.status === "fulfilled") {
      set({ settings: s.value });
      await migrateLegacyPullStrategy(s.value, get().update);
    }
    // Defaults stay in effect; a failed startup load is not worth interrupting the user.
    else console.warn(`Could not load settings, using defaults: ${message(s.reason)}`);
    if (k.status === "fulfilled") {
      const overrides = toOverrides(k.value);
      set({ overrides });
      setShortcutOverrides(overrides);
    }
  },

  update: async (patch) => {
    const before = get().settings ?? DEFAULT_SETTINGS;
    set({ settings: { ...before, ...patch } });
    try {
      const saved = await unwrap(commands.settingsSet({ ...before, ...patch }));
      set({ settings: saved });
      return { ok: true };
    } catch (e) {
      // Only roll back the fields this call changed, so concurrent updates survive.
      const rolled: Record<string, unknown> = { ...(get().settings ?? before) };
      for (const key of Object.keys(patch) as (keyof AppSettings)[]) rolled[key] = before[key];
      set({ settings: rolled as unknown as AppSettings });
      toast.error(message(e));
      return { ok: false, message: message(e) };
    }
  },

  saveOverrides: async (next) => {
    const before = get().overrides;
    set({ overrides: next });
    setShortcutOverrides(next);
    try {
      const saved = toOverrides(await unwrap(commands.keybindingsSet(fromOverrides(next))));
      set({ overrides: saved });
      setShortcutOverrides(saved);
      return { ok: true };
    } catch (e) {
      set({ overrides: before });
      setShortcutOverrides(before);
      toast.error(message(e));
      return { ok: false, message: message(e) };
    }
  },

  openDialog: (section) => set((s) => ({ open: true, section: section ?? s.section })),
  closeDialog: () => set({ open: false }),
  setSection: (section) => set({ section }),
}));

/** Current settings, falling back to defaults until loaded. */
export function useSettings(): AppSettings {
  return useSettingsStore((s) => s.settings) ?? DEFAULT_SETTINGS;
}

export const updateSettings = (patch: Partial<AppSettings>) =>
  useSettingsStore.getState().update(patch);

export const openSettings = (section?: SectionId) =>
  useSettingsStore.getState().openDialog(section);

const current = () => useSettingsStore.getState().settings ?? DEFAULT_SETTINGS;

/** Non-reactive getters for use inside commands and event handlers. */
export const getConfirmDestructive = () => current().confirmDestructive;
export const getPullStrategy = () => current().pullStrategy;
export const getDiffContextLines = () => current().diffContextLines;
export const getGraphOrder = () => current().graphOrder;
