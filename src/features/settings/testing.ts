/* Test helpers for the settings feature. Only imported from tests. */
import { vi } from "vitest";
import type { AppSettings, Keybinding } from "@/ipc/bindings";

export const baseSettings: AppSettings = {
  theme: "dark",
  gitPath: null,
  pullStrategy: "merge",
  confirmDestructive: true,
  graphOrder: "topo",
  diffContextLines: 3,
  avatars: "github",
};

/** Factory for `vi.mock("@/ipc/bindings", ...)`: the shared mock plus the settings commands. */
export async function settingsBindingsMock() {
  const mock = (await import("@/app/mockBindings")).bindingsMock();
  Object.assign(mock.commands, {
    settingsGet: vi.fn(),
    settingsSet: vi.fn(),
    keybindingsGet: vi.fn(),
    keybindingsSet: vi.fn(),
  });
  return mock;
}

type Fn = ReturnType<typeof vi.fn>;

/** Wires the settings commands: echo-saving by default. Returns the mocks for assertions. */
export function installSettingsBackend(
  commands: Record<string, unknown>,
  initial: { settings?: Partial<AppSettings>; keybindings?: Keybinding[] } = {},
) {
  const ok = <T>(data: T) => Promise.resolve({ status: "ok" as const, data });
  const c = commands as Record<
    "settingsGet" | "settingsSet" | "keybindingsGet" | "keybindingsSet",
    Fn
  >;
  c.settingsGet.mockImplementation(() => ok({ ...baseSettings, ...initial.settings }));
  c.settingsSet.mockImplementation((s: AppSettings) => ok(s));
  c.keybindingsGet.mockImplementation(() => ok(initial.keybindings ?? []));
  c.keybindingsSet.mockImplementation((b: Keybinding[]) => ok(b));
  return c;
}
