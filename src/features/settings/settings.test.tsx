import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandHost } from "@/app/commands/CommandHost";
import { useCommandStore } from "@/app/commands";
import { fail, ok } from "@/app/mockBindings";
import { installDomShims } from "@/app/testing";
import { TooltipProvider } from "@/design/components";
import { ThemeProvider } from "@/design/theme";
import { commands } from "@/ipc/bindings";
import {
  DEFAULT_SETTINGS,
  getConfirmDestructive,
  getDiffContextLines,
  getGraphOrder,
  getPullStrategy,
  updateSettings,
  useSettingsStore,
} from "@/stores/settings";
import { SettingsHost } from "./SettingsHost";
import { installSettingsBackend } from "./testing";

vi.mock("@/ipc/bindings", async () => (await import("./testing")).settingsBindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("/usr/bin/git2")),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
  Toaster: () => null,
}));

installDomShims();
Element.prototype.scrollIntoView ??= () => {};

const mocks = () => commands as unknown as ReturnType<typeof installSettingsBackend>;
const ctrl = (key: string) => `{Control>}${key}{/Control}`;

function setup(initial: Parameters<typeof installSettingsBackend>[1] = {}) {
  installSettingsBackend(commands as unknown as Record<string, unknown>, initial);
  (commands.appInfo as ReturnType<typeof vi.fn>).mockImplementation(() =>
    ok({ version: "1.2.3", gitVersion: "git version 2.45.0", platform: "linux" }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>
          <CommandHost />
          <SettingsHost />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard(ctrl(","));
  return screen.findByRole("dialog", { name: "Settings" });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  useCommandStore.setState({
    commands: {},
    paletteOpen: false,
    helpOpen: false,
    recent: [],
    shortcutOverrides: {},
  });
  useSettingsStore.setState({
    settings: null,
    overrides: {},
    open: false,
    section: "general",
  });
});

describe("settings store", () => {
  it("loads at startup and exposes getters", async () => {
    setup({
      settings: {
        pullStrategy: "rebase",
        graphOrder: "date",
        diffContextLines: 7,
        confirmDestructive: false,
      },
    });
    await waitFor(() => expect(getPullStrategy()).toBe("rebase"));
    expect(getGraphOrder()).toBe("date");
    expect(getDiffContextLines()).toBe(7);
    expect(getConfirmDestructive()).toBe(false);
  });

  it("falls back to defaults before load", () => {
    expect(getPullStrategy()).toBe(DEFAULT_SETTINGS.pullStrategy);
    expect(getConfirmDestructive()).toBe(true);
  });

  it("updates optimistically and persists the full settings", async () => {
    setup();
    await waitFor(() => expect(useSettingsStore.getState().settings).not.toBeNull());
    let pendingResolve: (v: unknown) => void = () => {};
    mocks().settingsSet.mockImplementationOnce(() => new Promise((r) => (pendingResolve = r)));
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = updateSettings({ graphOrder: "date" });
    });
    expect(getGraphOrder()).toBe("date");
    await act(async () => {
      pendingResolve({ status: "ok", data: { ...DEFAULT_SETTINGS, graphOrder: "date" } });
      await done;
    });
    expect(mocks().settingsSet).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, graphOrder: "date" });
  });

  it("rolls back and toasts the validation message on error", async () => {
    setup();
    await waitFor(() => expect(useSettingsStore.getState().settings).not.toBeNull());
    mocks().settingsSet.mockImplementationOnce(() => fail("invalidInput", "diff context too big"));
    let result: Awaited<ReturnType<typeof updateSettings>> | undefined;
    await act(async () => {
      result = await updateSettings({ diffContextLines: 9 });
    });
    expect(result).toEqual({ ok: false, message: "diff context too big" });
    expect(getDiffContextLines()).toBe(3);
    expect(toast.error).toHaveBeenCalledWith("diff context too big");
  });
});

describe("theme sync", () => {
  it("applies the saved theme to the provider", async () => {
    setup({ settings: { theme: "light" } });
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
  });

  it("persists a theme change from the Toggle theme command", async () => {
    const user = userEvent.setup();
    setup({ settings: { theme: "dark" } });
    await waitFor(() => expect(useSettingsStore.getState().settings).not.toBeNull());
    await user.keyboard(ctrl("k"));
    await user.click(await screen.findByRole("option", { name: /toggle theme/i }));
    await waitFor(() =>
      expect(mocks().settingsSet).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" })),
    );
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("changing the theme in the dialog restyles the app and saves", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("radio", { name: "Light" }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
    expect(mocks().settingsSet).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" }));
  });
});

describe("settings dialog", () => {
  it("opens with mod+, and is labelled", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openDialog(user);
    expect(
      within(dialog).getByRole("switch", { name: "Confirm destructive actions" }),
    ).toBeChecked();
    await user.click(within(dialog).getByRole("switch", { name: "Confirm destructive actions" }));
    await waitFor(() =>
      expect(mocks().settingsSet).toHaveBeenCalledWith(
        expect.objectContaining({ confirmDestructive: false }),
      ),
    );
  });

  it("shows backend validation errors for the git path", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Git" }));
    mocks().settingsSet.mockImplementationOnce(() => fail("invalidInput", "not a git executable"));
    const input = within(dialog).getByRole("textbox", { name: "Git executable path" });
    await user.type(input, "/bad/git{Enter}");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("not a git executable");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(getPullStrategy()).toBe("merge");
    expect(useSettingsStore.getState().settings?.gitPath).toBeNull();
  });

  it("browses for a git executable and saves it", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Git" }));
    await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
    await waitFor(() =>
      expect(mocks().settingsSet).toHaveBeenCalledWith(
        expect.objectContaining({ gitPath: "/usr/bin/git2" }),
      ),
    );
  });

  it("clamps diff context lines to 0..20 and saves pull strategy", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Git" }));
    const n = within(dialog).getByRole("spinbutton", { name: "Diff context lines" });
    await user.clear(n);
    await user.type(n, "99{Enter}");
    await waitFor(() => expect(getDiffContextLines()).toBe(20));
    await user.click(within(dialog).getByRole("radio", { name: "Rebase" }));
    await waitFor(() => expect(getPullStrategy()).toBe("rebase"));
  });

  it("shows About info and hides AI unless ai.settings is registered", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openDialog(user);
    expect(within(dialog).queryByRole("button", { name: "AI" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "About" }));
    expect(await within(dialog).findByText("1.2.3")).toBeInTheDocument();
    expect(within(dialog).getByText("git version 2.45.0")).toBeInTheDocument();
  });

  it("runs the ai.settings command from the AI row", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    setup();
    act(() =>
      useCommandStore
        .getState()
        .register([{ id: "ai.settings", title: "AI settings", group: "AI", run }]),
    );
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "AI" }));
    await user.click(within(dialog).getByRole("button", { name: /configure ai in ai settings/i }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });
});

describe("keyboard recorder", () => {
  async function openKeyboard(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Keyboard" }));
    return dialog;
  }

  it("records a chord, announces it, and saves the payload", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openKeyboard(user);
    await user.click(within(dialog).getByRole("button", { name: "Record shortcut for Refresh" }));
    expect(screen.getByRole("status")).toHaveTextContent(/recording shortcut for refresh/i);
    await user.keyboard("{Control>}{Shift>}u{/Shift}{/Control}");
    await waitFor(() =>
      expect(mocks().keybindingsSet).toHaveBeenCalledWith([
        { action: "repo.refresh", keys: "mod+shift+u" },
      ]),
    );
    expect(await within(dialog).findByText("Ctrl+Shift+U")).toBeInTheDocument();
    expect(useCommandStore.getState().shortcutOverrides["repo.refresh"]).toBe("mod+shift+u");
  });

  it("Escape cancels recording without closing the dialog", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openKeyboard(user);
    await user.click(within(dialog).getByRole("button", { name: "Record shortcut for Refresh" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(mocks().keybindingsSet).not.toHaveBeenCalled();
  });

  it("warns on conflicts and only saves when confirmed", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openKeyboard(user);
    await user.click(within(dialog).getByRole("button", { name: "Record shortcut for Refresh" }));
    await user.keyboard(ctrl("o"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already used by Open repository/);
    expect(mocks().keybindingsSet).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Assign anyway" }));
    await waitFor(() =>
      expect(mocks().keybindingsSet).toHaveBeenCalledWith([
        { action: "repo.refresh", keys: "mod+o" },
      ]),
    );
  });

  it("clears and resets a shortcut", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openKeyboard(user);
    await user.click(within(dialog).getByRole("button", { name: "Clear shortcut for Refresh" }));
    await waitFor(() =>
      expect(mocks().keybindingsSet).toHaveBeenLastCalledWith([
        { action: "repo.refresh", keys: "" },
      ]),
    );
    expect(useCommandStore.getState().shortcutOverrides["repo.refresh"]).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Reset shortcut for Refresh" }));
    await waitFor(() => expect(mocks().keybindingsSet).toHaveBeenLastCalledWith([]));
    expect(useCommandStore.getState().shortcutOverrides).toEqual({});
  });

  it("loads saved overrides at startup and rolls back on save error", async () => {
    const user = userEvent.setup();
    setup({ keybindings: [{ action: "repo.refresh", keys: "mod+u" }] });
    await waitFor(() =>
      expect(useCommandStore.getState().shortcutOverrides["repo.refresh"]).toBe("mod+u"),
    );
    const dialog = await openKeyboard(user);
    mocks().keybindingsSet.mockImplementationOnce(() => fail("invalidInput", "bad keys"));
    await user.click(within(dialog).getByRole("button", { name: "Reset shortcut for Refresh" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bad keys"));
    expect(useCommandStore.getState().shortcutOverrides["repo.refresh"]).toBe("mod+u");
  });
});
