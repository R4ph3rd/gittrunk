import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  change,
  installBackend,
  installDomShims,
  makeStatus,
  oid,
  ok,
  previewOutcome,
  renderApp,
  resetStore,
} from "@/app/testing";
import { useCommandStore } from "@/app/commands";
import { ANDROID_PLATFORM } from "@/app/platform";
import type { OplogState, RefsSnapshot, StatusSnapshot } from "@/ipc/bindings";
import { LAYOUT_STORAGE_KEY, useLayoutStore } from "@/stores/layout";
import { useWorkspaceStore } from "@/stores/workspace";
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

const dirty = () => makeStatus({ unstaged: [change("file.txt")] });

async function backend(
  refSnapshot = refs(),
  oplog = oplogState(),
  status: StatusSnapshot = makeStatus(),
) {
  const commands = await installBackend();
  commands.refsList.mockImplementation(() => ok(refSnapshot));
  commands.status.mockImplementation(() => ok(status));
  commands.oplogState.mockImplementation(() => ok(oplog));
  return commands;
}

async function openRepo() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const view = renderApp();
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("toolbar", { name: "Remote operations" });
  // Let refs, status and the oplog state settle so enabled states are final.
  await screen.findByText("Commit number 0");
  return { user, ...view };
}

const toolbar = () => screen.getByRole("toolbar", { name: "Remote operations" });
const button = (name: string | RegExp) => within(toolbar()).getByRole("button", { name });
const queryButton = (name: string | RegExp) => within(toolbar()).queryByRole("button", { name });

/** Radix menus open on pointerdown, which jsdom does not model; the keyboard path is equivalent. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  act(() => button(name).focus());
  await user.keyboard("{Enter}");
  return screen.findByRole("menu");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetStore();
  useCredentialQueue.getState().reset();
  useCommandStore.setState({ recent: [] });
});

const redoPreview = (dryRun: boolean) =>
  ok(
    dryRun
      ? previewOutcome("Will move main forward to def5678")
      : {
          kind: "applied",
          oplogId: "o2",
          head: { kind: "branch", name: "main", oid: oid(1) },
          message: "Redone commit",
        },
  );

describe("undo split button", () => {
  it("is disabled when there is nothing to undo", async () => {
    await backend(refs(), oplogState({ canUndo: false }));
    await openRepo();
    await waitFor(() => expect(button("Undo")).toBeDisabled());
  });

  it("previews the undo, confirms it and refreshes the oplog state", async () => {
    const commands = await backend(refs(), oplogState({ canUndo: true }));
    commands.undo.mockImplementation((_r: string, dryRun: boolean) =>
      ok(
        dryRun
          ? previewOutcome("Will move main back to abc1234")
          : {
              kind: "applied",
              oplogId: "o1",
              head: { kind: "branch", name: "main", oid: oid(0) },
              message: "Undone",
            },
      ),
    );
    const { user } = await openRepo();
    await waitFor(() => expect(button("Undo")).toBeEnabled());
    await user.click(button("Undo"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Undo last operation?");
    expect(within(dialog).getByText("Will move main back to abc1234")).toBeInTheDocument();
    expect(commands.undo).toHaveBeenCalledWith("r1", true);
    const before = commands.oplogState.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(commands.undo).toHaveBeenLastCalledWith("r1", false));
    await waitFor(() => expect(commands.oplogState.mock.calls.length).toBeGreaterThan(before));
  });

  it("describes the operation to undo in its tooltip", async () => {
    await backend(refs(), oplogState({ undoDescription: "Commit my changes" }));
    await openRepo();
    await waitFor(() => expect(button("Undo")).toBeEnabled());
    act(() => button("Undo").focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Undo: Commit my changes");
  });

  it("offers Redo, disabled when nothing was undone", async () => {
    await backend(refs(), oplogState({ canRedo: false }));
    const { user } = await openRepo();
    const menu = await openMenu(user, "Undo options");
    const item = within(menu).getByRole("menuitem", { name: /^Redo/ });
    expect(item).toHaveAttribute("data-disabled");
  });

  it("names the operation to redo with its shortcut", async () => {
    await backend(refs(), oplogState({ canRedo: true, redoDescription: "Commit my changes" }));
    const { user } = await openRepo();
    await waitFor(() => expect(button("Undo")).toBeEnabled());
    const menu = await openMenu(user, "Undo options");
    const item = within(menu).getByRole("menuitem", { name: /^Redo: Commit my changes/ });
    expect(item).not.toHaveAttribute("data-disabled");
    expect(item).toHaveTextContent(/Shift/i);
  });

  it("previews and applies a redo from the menu", async () => {
    const commands = await backend(refs(), oplogState({ canRedo: true }));
    commands.redo.mockImplementation((_r: string, dryRun: boolean) => redoPreview(dryRun));
    const { user } = await openRepo();
    const menu = await openMenu(user, "Undo options");
    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: /^Redo/ })).not.toHaveAttribute(
        "data-disabled",
      ),
    );
    await user.click(within(menu).getByRole("menuitem", { name: /^Redo/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Redo last undone operation?");
    expect(within(dialog).getByText("Will move main forward to def5678")).toBeInTheDocument();
    expect(commands.redo).toHaveBeenCalledWith("r1", true);
    await user.click(within(dialog).getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(commands.redo).toHaveBeenLastCalledWith("r1", false));
    expect(commands.undo).not.toHaveBeenCalled();
  });

  it("redoes with mod+shift+z", async () => {
    const commands = await backend(refs(), oplogState({ canRedo: true }));
    commands.redo.mockImplementation((_r: string, dryRun: boolean) => redoPreview(dryRun));
    const { user } = await openRepo();
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Redo last undone operation?");
    await user.click(within(dialog).getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(commands.redo).toHaveBeenLastCalledWith("r1", false));
  });
});

describe("branch and stash buttons", () => {
  async function createFeatureBranch(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await screen.findByRole("dialog", { name: "Create branch" });
    expect(dialog).toHaveTextContent("At main.");
    act(() => within(dialog).getByLabelText("Name").focus());
    await user.keyboard("feature/x");
    await user.click(within(dialog).getByRole("button", { name: "Create branch" }));
  }

  it("creates a branch at HEAD from the name prompt", async () => {
    const commands = await backend(refs({ head: { kind: "branch", name: "main", oid: oid(10) } }));
    const { user } = await openRepo();
    await waitFor(() => expect(button("Branch")).toBeEnabled());
    await user.click(button("Branch"));
    await createFeatureBranch(user);
    await waitFor(() =>
      expect(commands.branchCreate).toHaveBeenCalledWith(
        "r1",
        { name: "feature/x", startPoint: oid(10), checkout: true },
        expect.any(Boolean),
      ),
    );
  });

  it("creates a branch with mod+shift+b", async () => {
    const commands = await backend();
    const { user } = await openRepo();
    await user.keyboard("{Control>}{Shift>}b{/Shift}{/Control}");
    await createFeatureBranch(user);
    await waitFor(() =>
      expect(commands.branchCreate).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ name: "feature/x", startPoint: oid(0) }),
        expect.any(Boolean),
      ),
    );
  });

  it("disables Branch while HEAD is unborn", async () => {
    await backend(refs({ head: { kind: "unborn", name: "main" }, local: [] }));
    await openRepo();
    expect(button("Branch")).toBeDisabled();
  });

  it("disables Stash on a clean tree", async () => {
    await backend();
    await openRepo();
    expect(button("Stash")).toBeDisabled();
  });

  it("opens the stash dialog when only staged changes exist", async () => {
    await backend(refs(), oplogState(), makeStatus({ staged: [change("file.txt")] }));
    const { user } = await openRepo();
    await waitFor(() => expect(button("Stash")).toBeEnabled());
    await user.click(button("Stash"));
    expect(await screen.findByRole("dialog", { name: "Stash changes" })).toBeInTheDocument();
  });

  it("opens the stash dialog with mod+shift+s", async () => {
    await backend(refs(), oplogState(), dirty());
    const { user } = await openRepo();
    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    expect(await screen.findByRole("dialog", { name: "Stash changes" })).toBeInTheDocument();
  });

  it("orders the row Undo, Fetch, Pull, Push, Branch, Stash", async () => {
    await backend();
    await openRepo();
    const labels = within(toolbar())
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
    expect(labels).toEqual([
      "Undo",
      "Undo options",
      "Fetch",
      "Pull",
      "Pull options",
      "Push",
      "Push options",
      "Branch",
      "Stash",
    ]);
  });
});

describe("read-only platform", () => {
  async function openReadOnly() {
    const commands = await backend(
      refs({
        local: [
          {
            name: "main",
            fullName: "refs/heads/main",
            oid: oid(0),
            upstream: "origin/main",
            ahead: 0,
            behind: 2,
            isHead: true,
            remote: null,
          },
        ],
      }),
      oplogState({ canUndo: true, canRedo: true }),
      dirty(),
    );
    commands.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
    const opened = await openRepo();
    return { commands, ...opened };
  }

  it("keeps only Fetch and a fast-forward Pull", async () => {
    const { commands, user } = await openReadOnly();
    await waitFor(() => expect(queryButton("Undo")).toBeNull());
    for (const name of ["Undo options", /^Push/, "Branch", "Stash", "Pull options"]) {
      expect(queryButton(name)).toBeNull();
    }
    expect(button("Fetch")).toBeEnabled();
    await waitFor(() => expect(button(/^Pull/)).toBeEnabled());
    await user.click(button(/^Pull/));
    await waitFor(() =>
      expect(commands.pull).toHaveBeenCalledWith("r1", {
        remote: "origin",
        branch: "main",
        strategy: "ffOnly",
      }),
    );
  });

  it("disables write shortcuts and pulls fast-forward only", async () => {
    const { commands, user } = await openReadOnly();
    await waitFor(() => expect(queryButton("Undo")).toBeNull());
    await user.keyboard("{Control>}z{/Control}");
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    await user.keyboard("{Control>}{Shift>}b{/Shift}{/Control}");
    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    await user.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
    await user.keyboard("{Control>}{Shift>}a{/Shift}{/Control}");
    expect(commands.undo).not.toHaveBeenCalled();
    expect(commands.redo).not.toHaveBeenCalled();
    expect(commands.push).not.toHaveBeenCalled();
    expect(commands.stagePaths).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await user.keyboard("{Control>}{Shift>}l{/Shift}{/Control}");
    await waitFor(() =>
      expect(commands.pull).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ strategy: "ffOnly" }),
      ),
    );
  });
});

describe("staging.commit command", () => {
  it("shows the right panel on its Changes tab and focuses the summary", async () => {
    await backend(refs(), oplogState(), dirty());
    const { user } = await openRepo();
    act(() => useLayoutStore.getState().setVisible("right", false));
    expect(screen.queryByRole("tab", { name: /Changes/ })).toBeNull();

    await user.keyboard("{Control>}k{/Control}");
    const options = await screen.findAllByRole("option");
    const commit = options.find((o) => /^Commit(\s|$)/.test(o.textContent?.trim() ?? ""));
    expect(commit).toBeDefined();
    await user.click(commit!);

    expect(await screen.findByRole("tab", { name: /Changes/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useWorkspaceStore.getState().rightTab.r1).toBe("changes");
    expect(JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}")).toMatchObject({
      right: true,
    });
    await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "commit-summary"));
  });
});
