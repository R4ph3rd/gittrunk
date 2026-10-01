import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  change,
  installBackend,
  installDomShims,
  makeStatus,
  ok,
  renderApp,
  resetStore,
} from "@/app/testing";
import { ANDROID_PLATFORM, DESKTOP_PLATFORM } from "@/app/platform";
import { forgeReady, makeIssue } from "@/features/forge/testing";
import { LAYOUT_STORAGE_KEY } from "@/stores/layout";
import { openIssues, useWorkspaceStore } from "@/stores/workspace";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());
// The shell owns the panel, not the terminal: xterm needs a real canvas and matchMedia
// (covered by src/features/terminal/terminal.test.tsx), so stand in for it here.
vi.mock("@/features/terminal/TerminalPanel", () => ({
  TerminalPanel: ({ repoId, cwd }: { repoId: string; cwd: string }) => (
    <div data-testid="terminal-panel" data-repo={repoId} data-cwd={cwd} />
  ),
}));

installDomShims();

async function backend() {
  const commands = await installBackend();
  const status = {
    current: makeStatus({ unstaged: [change("src/a.ts")], staged: [change("src/b.ts", "added")] }),
  };
  commands.status.mockImplementation(() => ok(status.current));
  commands.stagePaths.mockImplementation((_r: string, paths: string[]) => {
    const moved = status.current.unstaged.filter((f) => paths.includes(f.path));
    status.current = makeStatus({
      unstaged: status.current.unstaged.filter((f) => !paths.includes(f.path)),
      staged: [...status.current.staged, ...moved],
    });
    return ok(null);
  });
  return commands;
}

async function openRepo() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderApp();
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("grid", { name: "Commit graph" });
  await screen.findByText("Commit number 0");
  return user;
}

const sidebar = () => screen.queryByRole("navigation", { name: "References" });
const pressed = (name: string) => screen.getByRole("button", { name });

beforeEach(async () => {
  resetStore();
  vi.clearAllMocks();
  window.localStorage.clear();
  await installBackend();
});

describe("repository tabs", () => {
  it("marks the active tab, opens the picker with + and closes a tab", async () => {
    await backend();
    const user = await openRepo();
    expect(screen.getByRole("tab", { name: "demo" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "Open repository" }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Close demo" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "demo" })).toBeNull());
  });
});

describe("layout toggles", () => {
  it("toggles the sidebar, terminal and right panel and persists them", async () => {
    await backend();
    const user = await openRepo();
    expect(screen.queryByTestId("terminal-panel")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Commit details" })).toBeInTheDocument();

    await user.click(pressed("Toggle terminal"));
    expect(await screen.findByTestId("terminal-panel")).toBeInTheDocument();
    expect(pressed("Toggle terminal")).toHaveAttribute("aria-pressed", "true");

    await user.click(pressed("Toggle changes panel"));
    expect(screen.queryByRole("complementary", { name: "Commit details" })).toBeNull();

    const sidebarBefore = sidebar();
    await user.click(pressed("Toggle sidebar"));
    if (sidebarBefore) expect(sidebar()).toBeNull();
    expect(pressed("Toggle sidebar")).toHaveAttribute("aria-pressed", "false");

    expect(JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}")).toEqual({
      sidebar: false,
      bottom: true,
      right: false,
    });
  });

  it("responds to mod+b, mod+j and mod+alt+b", async () => {
    await backend();
    const user = await openRepo();
    await user.keyboard("{Control>}j{/Control}");
    expect(await screen.findByTestId("terminal-panel")).toBeInTheDocument();
    await user.keyboard("{Control>}b{/Control}");
    expect(pressed("Toggle sidebar")).toHaveAttribute("aria-pressed", "false");
    await user.keyboard("{Control>}{Alt>}b{/Alt}{/Control}");
    expect(pressed("Toggle changes panel")).toHaveAttribute("aria-pressed", "false");
  });

  it("has no terminal toggle when the platform has no terminal", async () => {
    const commands = await backend();
    commands.platformInfo.mockImplementation(() =>
      ok({ ...DESKTOP_PLATFORM, supportsTerminal: false }),
    );
    await openRepo();
    expect(screen.queryByRole("button", { name: "Toggle terminal" })).toBeNull();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toBeInTheDocument();
  });
});

describe("right panel tabs", () => {
  it("follows the selection between Commit and Changes", async () => {
    await backend();
    const user = await openRepo();
    await user.click(await screen.findByTestId("wip-row"));
    expect(await screen.findByRole("complementary", { name: "Working copy" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Changes/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("changes-count")).toHaveTextContent("2");

    await user.click(screen.getByText("Commit number 2"));
    expect(
      await screen.findByRole("complementary", { name: "Commit details" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Commit" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows only the Commit tab when read-only", async () => {
    const commands = await backend();
    commands.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
    await openRepo();
    await screen.findByRole("complementary", { name: "Commit details" });
    expect(screen.queryByRole("tab", { name: /Changes/ })).toBeNull();
  });
});

describe("center views", () => {
  it("opens a commit file diff in the center and returns with Escape and Back", async () => {
    await backend();
    const user = await openRepo();
    const grid = screen.getByRole("grid", { name: "Commit graph" });
    await user.click(screen.getByText("Commit number 2"));
    const details = await screen.findByRole("complementary", { name: "Commit details" });
    await user.click(await within(details).findByRole("button", { name: /^M\s*src\/lib\.rs/ }));

    expect(await screen.findByTestId("file-diff")).toBeInTheDocument();
    const center = screen.getByTestId("center-area");
    expect(within(center).getByText("lib.rs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to graph" })).toBeInTheDocument();
    expect(within(details).getByRole("button", { name: /^M\s*src\/lib\.rs/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The graph stays mounted, only hidden.
    expect(grid).toBeInTheDocument();
    expect(grid.closest("[hidden]")).not.toBeNull();

    fireEvent.keyDown(screen.getByTestId("file-diff"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("file-diff")).toBeNull());
    expect(screen.getByRole("grid", { name: "Commit graph" })).toBe(grid);
    expect(grid.closest("[hidden]")).toBeNull();

    await user.click(within(details).getByRole("button", { name: /^M\s*src\/lib\.rs/ }));
    await screen.findByTestId("file-diff");
    await user.click(screen.getByRole("button", { name: "Back to graph" }));
    await waitFor(() => expect(screen.queryByTestId("file-diff")).toBeNull());
  });

  it("opens a working-copy diff in the center and follows a staged file", async () => {
    await backend();
    const user = await openRepo();
    await user.click(await screen.findByTestId("wip-row"));
    await screen.findByRole("complementary", { name: "Working copy" });
    const row = screen
      .getAllByRole("option")
      .find((r) => r.getAttribute("data-path") === "src/a.ts")!;
    await user.click(row);

    const center = screen.getByTestId("center-area");
    await within(center).findByTestId("staging-diff");
    expect(within(center).getByText("Unstaged")).toBeInTheDocument();
    expect(within(center).getAllByRole("button", { name: "Stage hunk" }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Stage src/a.ts" }));
    await waitFor(() => expect(within(center).getByText("Staged")).toBeInTheDocument());
    expect(useWorkspaceStore.getState().stacks.r1).toEqual([
      { kind: "worktreeDiff", path: "src/a.ts", staged: true },
    ]);
  });

  it("renders the forge main view for issues with its header", async () => {
    forgeReady(await backend(), { issues: [makeIssue(7, { title: "Crash on start" })] });
    const user = await openRepo();
    act(() => openIssues("r1"));
    expect(await screen.findByTestId("forge-main-view")).toHaveAttribute("data-view", "issues");
    const center = screen.getByTestId("center-area");
    expect(within(center).getByText("Issues", { selector: "span" })).toBeInTheDocument();
    expect(await within(center).findByText("Crash on start")).toBeInTheDocument();
    expect(
      screen.getByRole("grid", { name: "Commit graph", hidden: true }).closest("[hidden]"),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to graph" }));
    await waitFor(() => expect(screen.queryByTestId("forge-main-view")).toBeNull());
  });
});

describe("avatars", () => {
  async function selectCommit() {
    const user = await openRepo();
    await user.click(screen.getByText("Commit number 2"));
    return screen.findByRole("complementary", { name: "Commit details" });
  }

  it("shows an image when the backend returns a data URL", async () => {
    const commands = await backend();
    commands.avatarsGet.mockImplementation((subjects: unknown[]) =>
      ok(subjects.map(() => "data:image/png;base64,AAAA")),
    );
    const details = await selectCommit();
    await waitFor(() => expect(details.querySelector("img")).not.toBeNull());
    expect(details.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });

  it("falls back to initials otherwise", async () => {
    await backend();
    const details = await selectCommit();
    await within(details).findByText("Details for 2");
    expect(details.querySelector("img")).toBeNull();
    expect(within(details).getAllByText("AD").length).toBeGreaterThan(0);
  });
});
