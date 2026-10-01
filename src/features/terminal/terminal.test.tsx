import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANDROID_PLATFORM } from "@/app/platform";
import {
  emitTerminalExit,
  emitTerminalOutput,
  fail,
  installDomShims,
  ok,
  repoInfo,
  resetStore,
} from "@/app/testing";
import { TooltipProvider } from "@/design/components";
import { commands } from "@/ipc/bindings";
import { useLayoutStore } from "@/stores/layout";
import { useRepoStore } from "@/stores/repo";
import { TerminalPanel } from "./TerminalPanel";

const fakes = vi.hoisted(() => ({
  terms: [] as Array<{
    opts: { theme?: Record<string, string>; fontFamily?: string; fontSize?: number };
    open: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    emitData: (d: string) => void;
  }>,
}));

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 100;
    rows = 30;
    options: Record<string, unknown>;
    private handlers: Array<(d: string) => void> = [];
    open = vi.fn();
    write = vi.fn();
    dispose = vi.fn();
    reset = vi.fn();
    focus = vi.fn();
    loadAddon = vi.fn();
    onData = (cb: (d: string) => void) => {
      this.handlers.push(cb);
      return { dispose() {} };
    };
    constructor(opts: Record<string, unknown>) {
      this.options = opts;
      fakes.terms.push({
        opts: opts as never,
        open: this.open,
        write: this.write,
        dispose: this.dispose,
        reset: this.reset,
        emitData: (d) => this.handlers.forEach((h) => h(d)),
      });
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

installDomShims();

type Cmd = ReturnType<typeof vi.fn>;
const cmds = commands as unknown as Record<
  "platformInfo" | "terminalOpen" | "terminalWrite" | "terminalResize" | "terminalClose",
  Cmd
>;

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <TerminalPanel repoId="r1" cwd="/work/demo" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const settle = () => new Promise((r) => setTimeout(r, 0));

async function mount() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(wrap());
    await settle();
  });
  return view;
}

const last = () => fakes.terms[fakes.terms.length - 1]!;

beforeEach(() => {
  resetStore();
  fakes.terms.length = 0;
  vi.clearAllMocks();
  cmds.platformInfo.mockImplementation(() =>
    ok({ ...(ANDROID_PLATFORM as object), supportsTerminal: true }),
  );
  cmds.terminalOpen.mockImplementation(() => ok("term-1"));
  for (const n of ["terminalWrite", "terminalResize", "terminalClose"] as const) {
    cmds[n].mockImplementation(() => ok(null));
  }
  useRepoStore.getState().addRepo(repoInfo);
});

afterEach(() => {
  cleanup();
  useRepoStore.getState().removeRepo("r1");
});

describe("terminal panel", () => {
  it("opens the backend in the repo root with the fitted size and routes I/O", async () => {
    await mount();
    await waitFor(() => expect(cmds.terminalOpen).toHaveBeenCalledTimes(1));
    expect(cmds.terminalOpen).toHaveBeenCalledWith({ cwd: "/work/demo", cols: 100, rows: 30 });
    expect(last().open).toHaveBeenCalledTimes(1);

    act(() => emitTerminalOutput("term-1", "hi"));
    expect(last().write).toHaveBeenCalledWith("hi");

    act(() => last().emitData("ls\r"));
    expect(cmds.terminalWrite).toHaveBeenCalledWith("term-1", "ls\r");
  });

  it("keeps the session across unmount and remount", async () => {
    const view = await mount();
    await waitFor(() => expect(cmds.terminalOpen).toHaveBeenCalledTimes(1));
    const host = screen.getByTestId("terminal-host");
    view.unmount();
    expect(cmds.terminalClose).not.toHaveBeenCalled();
    await mount();
    expect(cmds.terminalOpen).toHaveBeenCalledTimes(1);
    expect(fakes.terms).toHaveLength(1);
    expect(last().open).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("terminal-host")).toBe(host);
  });

  it("shows the exit message and restarts on Enter", async () => {
    await mount();
    await waitFor(() => expect(cmds.terminalOpen).toHaveBeenCalledTimes(1));
    cmds.terminalOpen.mockImplementation(() => ok("term-2"));
    act(() => emitTerminalExit("term-1", 3));
    expect(last().write).toHaveBeenCalledWith(
      expect.stringContaining("[process exited with code 3; press Enter to restart]"),
    );
    act(() => last().emitData("x"));
    expect(cmds.terminalWrite).not.toHaveBeenCalled();
    act(() => last().emitData("\r"));
    await waitFor(() => expect(cmds.terminalOpen).toHaveBeenCalledTimes(2));
  });

  it("closes and disposes when the repo disappears", async () => {
    await mount();
    await waitFor(() => expect(cmds.terminalOpen).toHaveBeenCalledTimes(1));
    const term = last();
    act(() => useRepoStore.getState().removeRepo("r1"));
    expect(cmds.terminalClose).toHaveBeenCalledWith("term-1");
    expect(term.dispose).toHaveBeenCalled();
  });

  it("restarts and kills from the header", async () => {
    const user = userEvent.setup();
    await mount();
    await waitFor(() => expect(cmds.terminalOpen).toHaveBeenCalledTimes(1));
    cmds.terminalOpen.mockImplementation(() => ok("term-2"));
    await user.click(screen.getByRole("button", { name: "Restart terminal" }));
    await waitFor(() => expect(cmds.terminalOpen).toHaveBeenCalledTimes(2));
    expect(cmds.terminalClose).toHaveBeenCalledWith("term-1");
    await user.click(screen.getByRole("button", { name: "Kill terminal" }));
    await waitFor(() => expect(cmds.terminalClose).toHaveBeenCalledWith("term-2"));
    expect(last().write).toHaveBeenCalledWith(expect.stringContaining("terminal killed"));
  });

  it("hides the panel from the header", async () => {
    const user = userEvent.setup();
    useLayoutStore.getState().setVisible("bottom", true);
    await mount();
    await user.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(useLayoutStore.getState().bottom).toBe(false);
  });

  it("shows open errors inline with Retry", async () => {
    const user = userEvent.setup();
    cmds.terminalOpen.mockImplementationOnce(() => fail("invalid", "bad cwd"));
    await mount();
    expect(await screen.findByText("bad cwd")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("bad cwd")).toBeNull());
    expect(cmds.terminalOpen).toHaveBeenCalledTimes(2);
  });

  it("never calls the backend when the terminal is unsupported", async () => {
    cmds.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
    // usePlatform guesses from the user agent until the backend answers.
    const ua = vi.spyOn(navigator, "userAgent", "get");
    ua.mockReturnValue("Mozilla/5.0 (Linux; Android 14)");
    await mount();
    expect(await screen.findByText("Terminal unavailable")).toBeTruthy();
    await waitFor(() => expect(cmds.platformInfo).toHaveBeenCalled());
    expect(cmds.terminalOpen).not.toHaveBeenCalled();
    expect(fakes.terms).toHaveLength(0);
    ua.mockRestore();
  });

  it("reads the xterm theme and font from CSS variables", async () => {
    const root = document.documentElement;
    root.style.setProperty("--terminal-bg", "#010203");
    root.style.setProperty("--terminal-cursor", "#0a0b0c");
    root.style.setProperty("--font-mono", "TestMono");
    try {
      await mount();
      await waitFor(() => expect(fakes.terms).toHaveLength(1));
      expect(last().opts.theme?.background).toBe("#010203");
      expect(last().opts.theme?.cursor).toBe("#0a0b0c");
      expect(last().opts.fontFamily).toBe("TestMono");
      expect(last().opts.fontSize).toBe(12);
    } finally {
      root.style.removeProperty("--terminal-bg");
      root.style.removeProperty("--terminal-cursor");
      root.style.removeProperty("--font-mono");
    }
  });
});
