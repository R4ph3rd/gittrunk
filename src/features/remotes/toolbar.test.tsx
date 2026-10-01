import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBackend, installDomShims, oid, ok, renderApp, resetStore } from "@/app/testing";
import { useCommandStore } from "@/app/commands";
import { ANDROID_PLATFORM } from "@/app/platform";
import type { OplogState, RefsSnapshot } from "@/ipc/bindings";
import { useCredentialQueue } from "./credentials";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work")) }));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();
Element.prototype.scrollIntoView ??= () => {};

const oplogState = (partial: Partial<OplogState> = {}): OplogState => ({
  canUndo: true,
  canRedo: false,
  undoDescription: null,
  redoDescription: null,
  ...partial,
});

const refs = (overrides: Partial<RefsSnapshot> = {}): RefsSnapshot => ({
  head: { kind: "branch", name: "main", oid: oid(0) },
  local: [
    {
      name: "main",
      fullName: "refs/heads/main",
      oid: oid(0),
      upstream: null,
      ahead: 0,
      behind: 0,
      isHead: true,
      remote: null,
    },
  ],
  remote: [],
  tags: [],
  stashes: [],
  ...overrides,
});

async function backend(refSnapshot = refs(), oplog = oplogState()) {
  const commands = await installBackend();
  commands.refsList.mockImplementation(() => ok(refSnapshot));
  commands.status.mockImplementation(() => ok({ unstaged: [], staged: [], conflicted: [] }));
  commands.oplogState.mockImplementation(() => ok(oplog));
  return commands;
}

async function openRepo() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const view = renderApp();
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("toolbar", { name: "Remote operations" });
  return { user, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetStore();
  useCredentialQueue.getState().reset();
  useCommandStore.setState({ recent: [] });
});

describe("toolbar buttons", () => {
  it("shows undo disabled when canUndo is false", async () => {
    await backend(refs(), oplogState({ canUndo: false }));
    await openRepo();
    const undoBtn = screen.getByRole("button", { name: /^Undo/ });
    expect(undoBtn).toBeDisabled();
  });

  it("shows undo enabled when canUndo is true", async () => {
    await backend(refs(), oplogState({ canUndo: true }));
    await openRepo();
    const undoBtn = screen.getByRole("button", { name: /^Undo/ });
    expect(undoBtn).not.toBeDisabled();
  });

  it("shows tooltip with undo description", async () => {
    await backend(refs(), oplogState({ undoDescription: "Commit my changes" }));
    const { user } = await openRepo();
    const undoBtn = screen.getByRole("button", { name: /^Undo/ });
    await user.hover(undoBtn);
    await waitFor(() => {
      expect(screen.getByText(/Undo: Commit my changes/)).toBeInTheDocument();
    });
  });

  it("opens redo menu when chevron is clicked", async () => {
    await backend(refs(), oplogState({ canRedo: true }));
    const { user } = await openRepo();
    const chevron = screen.getByRole("button", { name: "Undo options" });
    await user.click(chevron);
    await waitFor(() => {
      expect(screen.getByText(/Redo/)).toBeInTheDocument();
    });
  });

  it("disables redo menu item when canRedo is false", async () => {
    await backend(refs(), oplogState({ canRedo: false }));
    const { user } = await openRepo();
    const chevron = screen.getByRole("button", { name: "Undo options" });
    await user.click(chevron);
    await waitFor(() => {
      const redoItem = screen.getByText(/Redo/).closest("[role='menuitem']");
      expect(redoItem).toHaveAttribute("data-disabled");
    });
  });

  it("shows redo description in menu when available", async () => {
    await backend(refs(), oplogState({ canRedo: true, redoDescription: "Undo my undo" }));
    const { user } = await openRepo();
    const chevron = screen.getByRole("button", { name: "Undo options" });
    await user.click(chevron);
    await waitFor(() => {
      expect(screen.getByText(/Redo: Undo my undo/)).toBeInTheDocument();
    });
  });

  it("opens redo preview on menu item click", async () => {
    const cmd = await backend(refs(), oplogState({ canRedo: true }));
    cmd.redo.mockImplementation(() =>
      ok({
        kind: "preview",
        summary: "Redoing some work",
        warnings: [],
      }),
    );
    const { user } = await openRepo();
    const chevron = screen.getByRole("button", { name: "Undo options" });
    await user.click(chevron);
    const redoMenuItem = screen.getByText(/^Redo/).closest("[role='menuitem']");
    await user.click(redoMenuItem!);
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toHaveTextContent("Redo last undone operation?");
      expect(screen.getByRole("alertdialog")).toHaveTextContent("Redoing some work");
    });
  });

  it("applies redo when dialog is confirmed", async () => {
    const cmd = await backend(refs(), oplogState({ canRedo: true }));
    cmd.redo
      .mockImplementationOnce(() =>
        ok({
          kind: "preview",
          summary: "Redoing some work",
          warnings: [],
        }),
      )
      .mockImplementationOnce(() =>
        ok({
          kind: "applied",
          message: "Redone",
        }),
      );
    const { user } = await openRepo();
    const chevron = screen.getByRole("button", { name: "Undo options" });
    await user.click(chevron);
    const redoMenuItem = screen.getByText(/^Redo/).closest("[role='menuitem']");
    await user.click(redoMenuItem!);
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toHaveTextContent("Redo last undone operation?");
    });
    const confirmBtn = screen.getByRole("button", { name: "Redo" });
    await user.click(confirmBtn);
    await waitFor(() => {
      expect(cmd.redo).toHaveBeenCalledWith(expect.any(String), false);
    });
  });

  it("shows Branch button and creates branch at HEAD", async () => {
    await backend(refs({ head: { kind: "branch", name: "main", oid: oid(10) } }));
    const { user } = await openRepo();
    const branchBtn = screen.getByRole("button", { name: /^Branch/ });
    expect(branchBtn).not.toBeDisabled();
    await user.click(branchBtn);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Branch name")).toBeInTheDocument();
    });
  });

  it("disables Branch button when HEAD is unborn", async () => {
    await backend(refs({ head: { kind: "unborn", name: "main" } }));
    await openRepo();
    const branchBtn = screen.getByRole("button", { name: /^Branch/ });
    expect(branchBtn).toBeDisabled();
  });

  it("disables Stash button when working tree is clean", async () => {
    await backend(refs());
    await openRepo();
    const stashBtn = screen.getByRole("button", { name: /^Stash/ });
    expect(stashBtn).toBeDisabled();
  });

  it("enables Stash button when working tree has changes", async () => {
    const cmd = await backend(refs());
    cmd.status.mockImplementation(() =>
      ok({
        unstaged: [{ path: "file.txt", status: "modified" }],
        staged: [],
        conflicted: [],
      }),
    );
    const { user } = await openRepo();
    const stashBtn = screen.getByRole("button", { name: /^Stash/ });
    expect(stashBtn).not.toBeDisabled();
    await user.click(stashBtn);
    await waitFor(() => {
      expect(screen.getByText(/Stash changes/)).toBeInTheDocument();
    });
  });

  it("responds to mod+shift+b shortcut to create branch", async () => {
    await backend();
    const { user } = await openRepo();
    await user.keyboard("{Control>}{Shift>}b{/Shift}{/Control}");
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Branch name")).toBeInTheDocument();
    });
  });

  it("responds to mod+shift+s shortcut to stash", async () => {
    const cmd = await backend();
    cmd.status.mockImplementation(() =>
      ok({
        unstaged: [{ path: "file.txt", status: "modified" }],
        staged: [],
        conflicted: [],
      }),
    );
    const { user } = await openRepo();
    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    await waitFor(() => {
      expect(screen.getByText(/Stash changes/)).toBeInTheDocument();
    });
  });
});

describe("read-only platform", () => {
  it("hides undo, push, branch, stash on android", async () => {
    const cmd = await backend();
    cmd.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
    await openRepo();
    expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Push/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Branch/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Stash/ })).not.toBeInTheDocument();
  });

  it("shows fetch and pull (fast-forward only) on android", async () => {
    const cmd = await backend();
    cmd.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
    await openRepo();
    expect(screen.getByRole("button", { name: /^Fetch/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Pull/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pull options" })).not.toBeInTheDocument();
  });
});

describe("staging.commit command", () => {
  it("shows right panel and selects changes tab", async () => {
    await backend();
    const { user } = await openRepo();
    const palette = screen.getByRole("button", { name: "Command palette" });
    await user.click(palette);
    const input = screen.getByRole("combobox");
    await user.type(input, "Commit");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      const rightPanel = screen.getByRole("button", { name: /Changes/ });
      expect(rightPanel).toBeInTheDocument();
    });
  });
});
