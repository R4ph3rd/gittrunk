import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRepoStore } from "@/stores/repo";
import { installDomShims } from "./testing";
import { CommandHost } from "./commands/CommandHost";
import {
  effectiveShortcut,
  setShortcutOverrides,
  useCommandStore,
  useRegisterCommands,
  type Command,
} from "./commands/registry";

vi.mock("@/ipc/bindings", async () => (await import("./mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve(null)) }));

installDomShims();
Element.prototype.scrollIntoView ??= () => {};

function Feature({ commands }: { commands: Command[] }) {
  useRegisterCommands(commands, [commands]);
  return null;
}

function setup(commands: Command[] = []) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CommandHost />
      <input aria-label="field" />
      <Feature commands={commands} />
    </QueryClientProvider>,
  );
}

const ctrl = (key: string) => `{Control>}${key}{/Control}`;
const PLACEHOLDER = /type a command/i;

beforeEach(() => {
  window.localStorage.clear();
  useCommandStore.setState({
    commands: {},
    paletteOpen: false,
    helpOpen: false,
    recent: [],
    shortcutOverrides: {},
  });
  useRepoStore.setState({ repos: [], activeId: null });
});

describe("command registry", () => {
  it("registers on mount and unregisters on unmount", () => {
    const cmd: Command = { id: "t.one", title: "One", group: "Test", run: () => {} };
    const { unmount } = setup([cmd]);
    expect(useCommandStore.getState().commands["t.one"]).toBe(cmd);
    unmount();
    expect(useCommandStore.getState().commands["t.one"]).toBeUndefined();
  });

  it("hides commands whose `when` is false", async () => {
    const user = userEvent.setup();
    setup([
      { id: "t.no", title: "Hidden thing", group: "Test", when: () => false, run: () => {} },
      { id: "t.yes", title: "Visible thing", group: "Test", run: () => {} },
    ]);
    await user.keyboard(ctrl("k"));
    expect(await screen.findByText("Visible thing")).toBeInTheDocument();
    expect(screen.queryByText("Hidden thing")).not.toBeInTheDocument();
  });
});

describe("command palette", () => {
  it("opens with mod+k, filters, runs with Enter and closes", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const other = vi.fn();
    setup([
      { id: "t.alpha", title: "Alpha action", group: "Test", shortcut: "mod+shift+a", run },
      { id: "t.beta", title: "Beta action", group: "Other", run: other },
    ]);
    await user.keyboard(ctrl("k"));
    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    expect(screen.getByText("Ctrl+Shift+A")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
    await user.type(input, "alpha");
    expect(screen.queryByText("Beta action")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(other).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
  });

  it("opens with mod+shift+p and closes with Escape", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("{Control>}{Shift>}p{/Shift}{/Control}");
    await screen.findByPlaceholderText(PLACEHOLDER);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument());
  });

  it("lists recently used commands first", async () => {
    const user = userEvent.setup();
    setup([
      { id: "t.a", title: "Aardvark", group: "Test", run: () => {} },
      { id: "t.b", title: "Badger", group: "Test", run: () => {} },
    ]);
    act(() => useCommandStore.getState().markUsed("t.b"));
    await user.keyboard(ctrl("k"));
    await screen.findByText("Recent");
    const items = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(items.findIndex((t) => t.includes("Badger"))).toBeLessThan(
      items.findIndex((t) => t.includes("Aardvark")),
    );
  });
});

describe("shortcuts", () => {
  it("runs a command by shortcut, but not while typing unless allowed", async () => {
    const user = userEvent.setup();
    const plain = vi.fn();
    const inInput = vi.fn();
    setup([
      { id: "t.plain", title: "Plain", group: "Test", shortcut: "mod+j", run: plain },
      {
        id: "t.input",
        title: "In input",
        group: "Test",
        shortcut: "mod+enter",
        allowInInput: true,
        run: inInput,
      },
    ]);
    await user.click(screen.getByLabelText("field"));
    await user.keyboard(ctrl("j"));
    expect(plain).not.toHaveBeenCalled();
    await user.keyboard(ctrl("{Enter}"));
    expect(inInput).toHaveBeenCalledTimes(1);
    await user.click(document.body);
    await user.keyboard(ctrl("j"));
    expect(plain).toHaveBeenCalledTimes(1);
  });

  it("opens the shortcuts help with ? and lists shortcuts", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("?");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.getByText("Open repository")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
  });

  it("refresh needs an active repo and prevents the browser reload", async () => {
    setup();
    const press = () => {
      const e = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, cancelable: true });
      act(() => {
        window.dispatchEvent(e);
      });
      return e.defaultPrevented;
    };
    expect(press()).toBe(false);
    act(() => useRepoStore.setState({ activeId: "r1" }));
    expect(press()).toBe(true);
  });
});

describe("shortcut overrides", () => {
  it("resolves overrides, with null unbinding", () => {
    const c = { id: "t.a", shortcut: "mod+j" };
    expect(effectiveShortcut(c, {})).toBe("mod+j");
    expect(effectiveShortcut(c, { "t.a": "mod+u" })).toBe("mod+u");
    expect(effectiveShortcut(c, { "t.a": null })).toBeUndefined();
    expect(effectiveShortcut({ id: "t.b" }, { "t.b": "mod+u" })).toBe("mod+u");
  });

  it("applies overrides to the matcher and the help display live", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    setup([{ id: "t.a", title: "Alpha", group: "Test", shortcut: "mod+j", run }]);
    act(() => setShortcutOverrides({ "t.a": "mod+u" }));
    await user.keyboard(ctrl("j"));
    expect(run).not.toHaveBeenCalled();
    await user.keyboard(ctrl("u"));
    expect(run).toHaveBeenCalledTimes(1);
    await user.keyboard("?");
    expect(await screen.findByText("Ctrl+U")).toBeInTheDocument();
    expect(screen.queryByText("Ctrl+J")).not.toBeInTheDocument();
    act(() => setShortcutOverrides({ "t.a": null }));
    await user.keyboard("{Escape}");
    await user.keyboard(ctrl("u"));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
