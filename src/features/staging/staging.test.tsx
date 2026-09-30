import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  change,
  installBackend,
  installDomShims,
  makeStatus,
  ok,
  oid,
  previewOutcome,
  renderApp,
  resetStore,
} from "@/app/testing";
import { fail } from "@/app/mockBindings";
import { useRepoStore } from "@/stores/repo";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
  Toaster: () => null,
}));

installDomShims();

type Fn = ReturnType<typeof vi.fn>;
const dirty = () =>
  makeStatus({
    unstaged: [change("src/a.ts"), change("README.md")],
    staged: [change("src/b.ts", "added")],
  });

async function backend(status = dirty()) {
  const commands = await installBackend();
  commands.status.mockImplementation(() => ok(status));
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

async function openStaging() {
  const user = await openRepo();
  await user.click(await screen.findByTestId("wip-row"));
  await screen.findByRole("complementary", { name: "Working copy" });
  return user;
}

/** Focuses then types: in jsdom the resizable panel group swallows mousedown, so click cannot focus. */
async function typeInto(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, text: string) {
  act(() => el.focus());
  await user.keyboard(text);
}

const rowFor = (path: string) =>
  screen.getAllByRole("option").find((r) => r.getAttribute("data-path") === path)!;

/** Diff rows are matched by text because syntax highlighting splits content into spans. */
const diffRow = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('tr[data-state="diff"]')].find((r) =>
    r.textContent?.includes(text),
  )!;

beforeEach(async () => {
  resetStore();
  vi.clearAllMocks();
  await installBackend();
});

describe("WIP row", () => {
  it("is absent when the working tree is clean", async () => {
    await backend(makeStatus());
    await openRepo();
    await screen.findByTestId("repo-status");
    expect(screen.queryByTestId("wip-row")).not.toBeInTheDocument();
  });

  it("shows counts when dirty and switches the right panel to staging and back", async () => {
    await backend();
    const user = await openRepo();
    const row = await screen.findByTestId("wip-row");
    expect(row).toHaveTextContent("// WIP");
    expect(row).toHaveTextContent("1 staged · 2 unstaged");
    expect(screen.getByRole("complementary", { name: "Commit details" })).toBeInTheDocument();

    await user.click(row);
    expect(await screen.findByRole("complementary", { name: "Working copy" })).toBeInTheDocument();
    expect(useRepoStore.getState().selection.r1).toEqual({ kind: "wip" });

    await user.click(screen.getByText("Commit number 2"));
    const details = await screen.findByRole("complementary", { name: "Commit details" });
    expect(await within(details).findByText("Details for 2")).toBeInTheDocument();
    expect(useRepoStore.getState().selection.r1).toEqual({ kind: "commit", oid: oid(2) });
  });

  it("is reachable from the keyboard: the button and ArrowUp from the first commit", async () => {
    await backend();
    const user = await openRepo();
    const row = await screen.findByTestId("wip-row");
    row.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("complementary", { name: "Working copy" })).toBeInTheDocument();

    const grid = screen.getByRole("grid", { name: "Commit graph" });
    grid.focus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByText("Details for 0")).toBeInTheDocument();
    await user.keyboard("{ArrowUp}");
    expect(await screen.findByRole("complementary", { name: "Working copy" })).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByText("Details for 0")).toBeInTheDocument();
  });
});

describe("file list", () => {
  it("lists unstaged, staged and conflicted files separately", async () => {
    await backend(
      makeStatus({
        unstaged: [change("src/a.ts")],
        staged: [change("src/b.ts", "added")],
        conflicted: [change("src/c.ts", "conflicted")],
      }),
    );
    await openStaging();
    const conflicted = screen.getByTestId("section-conflicted");
    expect(within(conflicted).getByText("conflict")).toBeInTheDocument();
    expect(within(conflicted).getByText("c.ts")).toBeInTheDocument();
    expect(within(screen.getByTestId("section-unstaged")).getByText("a.ts")).toBeInTheDocument();
    expect(within(screen.getByTestId("section-staged")).getByText("b.ts")).toBeInTheDocument();
  });

  it("stages and unstages files with the row buttons and refetches status", async () => {
    const commands = await backend();
    const user = await openStaging();
    const before = commands.status.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Stage src/a.ts" }));
    await waitFor(() => expect(commands.stagePaths).toHaveBeenCalledWith("r1", ["src/a.ts"]));
    await waitFor(() => expect(commands.status.mock.calls.length).toBeGreaterThan(before));

    await user.click(screen.getByRole("button", { name: "Unstage src/b.ts" }));
    await waitFor(() => expect(commands.unstagePaths).toHaveBeenCalledWith("r1", ["src/b.ts"]));
  });

  it("stages and unstages everything from the section headers", async () => {
    const commands = await backend();
    const user = await openStaging();
    await user.click(screen.getByRole("button", { name: "Stage all" }));
    await waitFor(() =>
      expect(commands.stagePaths).toHaveBeenCalledWith("r1", ["src/a.ts", "README.md"]),
    );
    await user.click(screen.getByRole("button", { name: "Unstage all" }));
    await waitFor(() => expect(commands.unstagePaths).toHaveBeenCalledWith("r1", ["src/b.ts"]));
  });

  it("Space stages the focused file and applies to a Ctrl/Shift multi-selection", async () => {
    const commands = await backend();
    const user = await openStaging();
    await user.click(rowFor("src/a.ts"));
    await user.keyboard("{Shift>}");
    await user.click(rowFor("README.md"));
    await user.keyboard("{/Shift}");
    expect(rowFor("src/a.ts")).toHaveAttribute("aria-selected", "true");
    expect(rowFor("README.md")).toHaveAttribute("aria-selected", "true");
    act(() => screen.getByRole("listbox", { name: "Changed files" }).focus());
    await user.keyboard(" ");
    await waitFor(() =>
      expect(commands.stagePaths).toHaveBeenCalledWith("r1", ["src/a.ts", "README.md"]),
    );

    // a Shift range never crosses into another section
    await user.click(rowFor("src/a.ts"));
    await user.keyboard("{Shift>}");
    await user.click(rowFor("src/b.ts"));
    await user.keyboard("{/Shift}");
    expect(rowFor("src/b.ts")).toHaveAttribute("aria-selected", "false");
  });

  it("Enter opens the diff of the focused file", async () => {
    const commands = await backend();
    const user = await openStaging();
    screen.getByRole("listbox", { name: "Changed files" }).focus();
    await user.keyboard("{Enter}"); // focusing the list focuses the first file
    await waitFor(() =>
      expect(commands.worktreeFileDiff).toHaveBeenCalledWith(
        "r1",
        "src/a.ts",
        false,
        expect.objectContaining({ ignoreWhitespace: false }),
      ),
    );
    expect(await screen.findByTestId("staging-diff")).toBeInTheDocument();
  });

  it("offers Stage, Discard and Copy path in the context menu", async () => {
    const commands = await backend();
    await openStaging();
    fireEvent.contextMenu(rowFor("src/a.ts"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Discard changes/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Copy path/ })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Stage/ }));
    await waitFor(() => expect(commands.stagePaths).toHaveBeenCalledWith("r1", ["src/a.ts"]));
  });
});

describe("discard", () => {
  it("dry-runs first, shows the preview, executes on confirm and offers Undo", async () => {
    const commands = await backend();
    const user = await openStaging();
    fireEvent.contextMenu(rowFor("src/a.ts"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Discard changes/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(commands.discardPaths).toHaveBeenCalledTimes(1);
    expect(commands.discardPaths).toHaveBeenLastCalledWith("r1", ["src/a.ts"], true);
    expect(within(dialog).getByText("Will discard changes")).toBeInTheDocument();
    expect(within(dialog).getByText("src/a.ts")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(commands.discardPaths).toHaveBeenLastCalledWith("r1", ["src/a.ts"], false),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [message, opts] = (toast.success as unknown as Fn).mock.calls[0]!;
    expect(message).toBe("discard changes");
    expect(opts.action.label).toBe("Undo");

    act(() => opts.action.onClick());
    await waitFor(() => expect(commands.undo).toHaveBeenCalledWith("r1", false));
  });

  it("does nothing when the confirmation is cancelled", async () => {
    const commands = await backend();
    const user = await openStaging();
    fireEvent.contextMenu(rowFor("README.md"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Discard changes/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(commands.discardPaths).toHaveBeenCalledTimes(1);
    expect(commands.discardPaths).toHaveBeenCalledWith("r1", ["README.md"], true);
  });
});

describe("diff viewer", () => {
  async function openDiff(staged = false) {
    const commands = await backend();
    const user = await openStaging();
    await user.click(rowFor(staged ? "src/b.ts" : "src/a.ts"));
    await screen.findByTestId("staging-diff");
    await waitFor(() =>
      expect(document.querySelectorAll("tr[data-state='diff']").length).toBeGreaterThan(0),
    );
    return { commands, user };
  }

  it("renders every hunk with per-hunk actions and toggles split/unified (persisted)", async () => {
    await openDiff();
    expect(screen.getAllByTestId("diff-hunk")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Stage hunk" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Discard hunk" })).toHaveLength(2);
    expect(diffRow("new A")).toBeTruthy();
    expect(document.querySelector("[data-line-old-num]")).toBeTruthy(); // unified layout

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Split" })); // Radix tabs switch on mousedown
    expect(useRepoStore.getState().diffMode).toBe("split");
    await waitFor(() => expect(document.querySelector("[data-line-num]")).toBeTruthy());
    expect(window.localStorage.getItem("gittrunk.diffMode")).toBe("split");
    useRepoStore.getState().setDiffMode("unified");
  });

  it("stages a whole hunk with lines: null and the fetch options", async () => {
    const { commands, user } = await openDiff();
    await user.click(screen.getAllByRole("button", { name: "Stage hunk" })[1]!);
    await waitFor(() =>
      expect(commands.stageLines).toHaveBeenCalledWith("r1", {
        path: "src/a.ts",
        options: { contextLines: 3, ignoreWhitespace: false },
        hunks: [{ hunkIndex: 1, lines: null }],
      }),
    );
  });

  it("selects lines by click and Shift+click and stages exactly those", async () => {
    const { commands, user } = await openDiff();
    await user.click(diffRow("new A"));
    await user.keyboard("{Shift>}");
    await user.click(diffRow("new C"));
    await user.keyboard("{/Shift}");
    expect(await screen.findByText("3 lines selected")).toBeInTheDocument();
    expect(diffRow("new B")).toHaveAttribute("data-selected");
    expect(diffRow("old a")).not.toHaveAttribute("data-selected");

    // a context row is not selectable
    await user.click(diffRow("bottom"));
    expect(screen.getByText("3 lines selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stage lines" }));
    await waitFor(() =>
      expect(commands.stageLines).toHaveBeenCalledWith("r1", {
        path: "src/a.ts",
        options: { contextLines: 3, ignoreWhitespace: false },
        hunks: [{ hunkIndex: 0, lines: [3, 4, 5] }],
      }),
    );
  });

  it("selects a deleted line and a line in another hunk in split mode", async () => {
    useRepoStore.getState().setDiffMode("split");
    const { commands, user } = await openDiff();
    await user.click(diffRow("old b"));
    await user.click(diffRow("added z"));
    expect(await screen.findByText("2 lines selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stage lines" }));
    await waitFor(() =>
      expect(commands.stageLines).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({
          hunks: [
            { hunkIndex: 0, lines: [2] },
            { hunkIndex: 1, lines: [1] },
          ],
        }),
      ),
    );
    useRepoStore.getState().setDiffMode("unified");
  });

  it("discards selected lines through the dry-run confirmation", async () => {
    const { commands, user } = await openDiff();
    await user.click(diffRow("new B"));
    await user.click(screen.getByRole("button", { name: "Discard lines" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(commands.discardLines).toHaveBeenLastCalledWith(
      "r1",
      expect.objectContaining({ hunks: [{ hunkIndex: 0, lines: [4] }] }),
      true,
    );
    expect(within(dialog).getByText(/1 line\)/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(commands.discardLines).toHaveBeenLastCalledWith("r1", expect.anything(), false),
    );
  });

  it("offers unstage actions for a staged file and no discard", async () => {
    const { commands, user } = await openDiff(true);
    expect(screen.queryByRole("button", { name: "Discard hunk" })).not.toBeInTheDocument();
    await user.click(diffRow("new B"));
    await user.click(screen.getByRole("button", { name: "Unstage lines" }));
    await waitFor(() => expect(commands.unstageLines).toHaveBeenCalled());
    await user.click(screen.getAllByRole("button", { name: "Unstage hunk" })[0]!);
    await waitFor(() =>
      expect(commands.unstageLines).toHaveBeenLastCalledWith(
        "r1",
        expect.objectContaining({
          hunks: [{ hunkIndex: 0, lines: null }],
        }),
      ),
    );
    expect(commands.worktreeFileDiff).toHaveBeenCalledWith(
      "r1",
      "src/b.ts",
      true,
      expect.anything(),
    );
  });

  it("refetches status and diffs after staging lines", async () => {
    const { commands, user } = await openDiff();
    const statusCalls = commands.status.mock.calls.length;
    const diffCalls = commands.worktreeFileDiff.mock.calls.length;
    await user.click(screen.getAllByRole("button", { name: "Stage hunk" })[0]!);
    await waitFor(() => expect(commands.status.mock.calls.length).toBeGreaterThan(statusCalls));
    await waitFor(() =>
      expect(commands.worktreeFileDiff.mock.calls.length).toBeGreaterThan(diffCalls),
    );
  });

  it("shows an empty state for binary files", async () => {
    const commands = await backend();
    commands.worktreeFileDiff.mockImplementation(() =>
      ok({ path: "img.png", oldPath: null, status: "modified", binary: true, hunks: [] }),
    );
    const user = await openStaging();
    await user.click(rowFor("src/a.ts"));
    expect(await screen.findByText("Binary file")).toBeInTheDocument();
  });

  it("caps huge diffs and shows the rest on demand", async () => {
    const commands = await backend();
    const big = (start: number, n: number) => ({
      header: `@@ -${start},${n} +${start},${n} @@`,
      oldStart: start,
      oldLines: 0,
      newStart: start,
      newLines: n,
      lines: Array.from({ length: n }, (_, i) => ({
        kind: "add" as const,
        oldLineno: null,
        newLineno: start + i,
        content: "x",
      })),
    });
    commands.worktreeFileDiff.mockImplementation(() =>
      ok({
        path: "src/a.ts",
        oldPath: null,
        status: "modified",
        binary: false,
        hunks: [big(1, 3990), big(5000, 30)],
      }),
    );
    const user = await openStaging();
    await user.click(rowFor("src/a.ts"));
    expect(await screen.findByText(/Large diff: 30 of 4020 lines not shown/)).toBeInTheDocument();
    expect(screen.getAllByTestId("diff-hunk")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Show full diff" }));
    await waitFor(() => expect(screen.getAllByTestId("diff-hunk")).toHaveLength(2));
  });
});

describe("commit box", () => {
  const commitButton = () => screen.getByRole("button", { name: /^(Commit|Amend commit)$/ });

  it("is disabled until there is a summary and something staged", async () => {
    await backend(makeStatus({ unstaged: [change("src/a.ts")] }));
    const user = await openStaging();
    expect(commitButton()).toBeDisabled();
    await typeInto(user, screen.getByLabelText("Summary"), "fix things");
    expect(commitButton()).toBeDisabled();
    expect(screen.getByTestId("commit-hint")).toHaveTextContent("Stage changes to commit");
  });

  it("shows the 72 character soft limit", async () => {
    await backend();
    const user = await openStaging();
    const count = screen.getByTestId("summary-count");
    expect(count).toHaveTextContent("0/72");
    act(() => screen.getByLabelText("Summary").focus());
    await user.paste("x".repeat(73));
    expect(count).toHaveTextContent("73/72");
    expect(count).toHaveAttribute("data-over");
    expect(commitButton()).toBeEnabled(); // soft limit: a warning, not a block
  });

  it("commits with summary and description, then offers Undo", async () => {
    const commands = await backend();
    const user = await openStaging();
    await typeInto(user, screen.getByLabelText("Summary"), "feat: add x");
    await typeInto(user, screen.getByLabelText("Description"), "Body text");
    await user.click(screen.getByRole("switch", { name: "Sign-off" }));
    await user.click(commitButton());
    await waitFor(() =>
      expect(commands.commitCreate).toHaveBeenCalledWith("r1", {
        message: "feat: add x\n\nBody text",
        amend: false,
        signOff: true,
        allowEmpty: false,
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const opts = (toast.success as unknown as Fn).mock.calls[0]![1];
    act(() => opts.action.onClick());
    await waitFor(() => expect(commands.undo).toHaveBeenCalledWith("r1", false));
    await waitFor(() => expect(screen.getByLabelText("Summary")).toHaveValue(""));
  });

  it("commits with Ctrl+Enter from the summary and the description", async () => {
    const commands = await backend();
    const user = await openStaging();
    await typeInto(user, screen.getByLabelText("Summary"), "one{Control>}{Enter}{/Control}");
    await waitFor(() => expect(commands.commitCreate).toHaveBeenCalledTimes(1));
    await typeInto(user, screen.getByLabelText("Summary"), "two");
    await typeInto(user, screen.getByLabelText("Description"), "b{Control>}{Enter}{/Control}");
    await waitFor(() => expect(commands.commitCreate).toHaveBeenCalledTimes(2));
    expect(commands.commitCreate).toHaveBeenLastCalledWith(
      "r1",
      expect.objectContaining({ message: "two\n\nb" }),
    );
  });

  it("does not commit with Ctrl+Enter when the form is invalid", async () => {
    const commands = await backend(makeStatus({ unstaged: [change("src/a.ts")] }));
    const user = await openStaging();
    await typeInto(user, screen.getByLabelText("Summary"), "x{Control>}{Enter}{/Control}");
    expect(commands.commitCreate).not.toHaveBeenCalled();
  });

  it("shows backend errors inline and keeps the message", async () => {
    const commands = await backend();
    commands.commitCreate.mockImplementation(() =>
      fail("invalidInput", "Please tell git who you are: user.name is not set"),
    );
    const user = await openStaging();
    await typeInto(user, screen.getByLabelText("Summary"), "msg");
    await user.click(commitButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("user.name is not set");
    expect(screen.getByLabelText("Summary")).toHaveValue("msg");
  });

  it("Amend prefills the HEAD message and restores the draft when switched off", async () => {
    const commands = await backend();
    const user = await openStaging();
    await typeInto(user, screen.getByLabelText("Summary"), "draft");
    await user.click(screen.getByRole("switch", { name: "Amend" }));
    await waitFor(() => expect(commands.commitDetails).toHaveBeenCalledWith("r1", oid(0)));
    await waitFor(() => expect(screen.getByLabelText("Summary")).toHaveValue("Details for 0"));
    expect(screen.getByLabelText("Description")).toHaveValue("Body text");
    expect(commitButton()).toHaveTextContent("Amend commit");

    await user.click(commitButton());
    await waitFor(() =>
      expect(commands.commitCreate).toHaveBeenCalledWith("r1", {
        message: "Details for 0\n\nBody text",
        amend: true,
        signOff: false,
        allowEmpty: false,
      }),
    );
  });

  it("amend works with nothing staged; turning it off restores the typed draft", async () => {
    await backend(makeStatus({ unstaged: [change("src/a.ts")] }));
    const user = await openStaging();
    await typeInto(user, screen.getByLabelText("Summary"), "draft");
    await user.click(screen.getByRole("switch", { name: "Amend" }));
    await waitFor(() => expect(screen.getByLabelText("Summary")).toHaveValue("Details for 0"));
    expect(commitButton()).toBeEnabled();
    await user.click(screen.getByRole("switch", { name: "Amend" }));
    expect(screen.getByLabelText("Summary")).toHaveValue("draft");
  });
});

describe("stash", () => {
  const stashEntry = { index: 0, oid: oid(9), message: "wip on main", branch: "main", time: 1 };

  async function withStash() {
    const commands = await backend();
    const original = commands.refsList.getMockImplementation() as (
      ...a: unknown[]
    ) => Promise<unknown>;
    commands.refsList.mockImplementation(async (...args: unknown[]) => {
      const res = (await original(...args)) as { status: "ok"; data: Record<string, unknown> };
      return { status: "ok", data: { ...res.data, stashes: [stashEntry] } };
    });
    const user = await openRepo();
    return { commands, user };
  }

  const openMenu = async () => {
    fireEvent.contextMenu(await screen.findByText("wip on main"));
    return screen.findByRole("menu");
  };

  it("applies a stash from the sidebar context menu and offers Undo", async () => {
    const { commands } = await withStash();
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Apply" }));
    await waitFor(() => expect(commands.stashApply).toHaveBeenCalledWith("r1", 0, false));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Stash applied", expect.anything()),
    );
    const opts = (toast.success as unknown as Fn).mock.calls[0]![1];
    act(() => opts.action.onClick());
    await waitFor(() => expect(commands.undo).toHaveBeenCalledWith("r1", false));
  });

  it("pops a stash", async () => {
    const { commands } = await withStash();
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Pop" }));
    await waitFor(() => expect(commands.stashApply).toHaveBeenCalledWith("r1", 0, true));
  });

  it("reports stash conflicts with a warning and Undo", async () => {
    const { commands } = await withStash();
    commands.stashApply.mockImplementation(() =>
      ok({ kind: "conflicted", oplogId: "op2", files: ["a.ts", "b.ts"] }),
    );
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Apply" }));
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Stash applied: conflicts in 2 file(s)",
        expect.objectContaining({ action: expect.anything() }),
      ),
    );
  });

  it("drops a stash only after a dry-run preview and confirmation", async () => {
    const { commands, user } = await withStash();
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Drop" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(commands.stashDrop).toHaveBeenCalledTimes(1);
    expect(commands.stashDrop).toHaveBeenLastCalledWith("r1", 0, true);
    expect(within(dialog).getByText("Will drop stash")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Drop" }));
    await waitFor(() => expect(commands.stashDrop).toHaveBeenLastCalledWith("r1", 0, false));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("drop stash", expect.anything()),
    );
  });

  it("cancelling the drop confirmation executes nothing", async () => {
    const { commands, user } = await withStash();
    commands.stashDrop.mockImplementation(() => ok(previewOutcome("Will drop it")));
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Drop" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(commands.stashDrop).toHaveBeenCalledTimes(1);
  });

  it("saves changes from the Stash dialog with its options", async () => {
    const commands = await backend();
    const user = await openStaging();
    await user.click(screen.getByRole("button", { name: "Stash" }));
    const dialog = await screen.findByRole("dialog", { name: "Stash changes" });
    await typeInto(user, within(dialog).getByLabelText("Message"), "half done");
    await user.click(within(dialog).getByRole("switch", { name: "Include untracked files" }));
    await user.click(within(dialog).getByRole("button", { name: "Stash changes" }));
    await waitFor(() =>
      expect(commands.stashSave).toHaveBeenCalledWith("r1", {
        message: "half done",
        includeUntracked: true,
        keepIndex: false,
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Changes stashed", expect.anything()),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Stash changes" })).not.toBeInTheDocument(),
    );
  });

  it("uses a null message when left empty and supports keep-index", async () => {
    const commands = await backend();
    const user = await openStaging();
    await user.click(screen.getByRole("button", { name: "Stash" }));
    const dialog = await screen.findByRole("dialog", { name: "Stash changes" });
    await user.click(within(dialog).getByRole("switch", { name: "Keep staged changes" }));
    await user.click(within(dialog).getByRole("button", { name: "Stash changes" }));
    await waitFor(() =>
      expect(commands.stashSave).toHaveBeenCalledWith("r1", {
        message: null,
        includeUntracked: false,
        keepIndex: true,
      }),
    );
  });
});
