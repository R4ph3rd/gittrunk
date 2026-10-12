import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANDROID_PLATFORM } from "@/app/platform";
import { change, installBackend, installDomShims, makeStatus, ok } from "@/app/testing";
import { fail } from "@/app/mockBindings";
import { useHistoryViews } from "@/features/history-views/store";
import { FileList } from "./FileList";
import { useFileListMode } from "./fileListMode";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));

installDomShims();

type Fn = ReturnType<typeof vi.fn>;

const status = () =>
  makeStatus({
    unstaged: [
      change("src/a.ts"),
      change("src/new.ts", "untracked"),
      change("Makefile"),
      change("notes.txt", "untracked"),
    ],
    staged: [change("lib/c.log", "added")],
  });

async function setup(opts: { android?: boolean; mode?: "list" | "tree" } = {}) {
  useFileListMode.setState({ mode: opts.mode ?? "list", collapsed: new Set() });
  const commands = await installBackend();
  if (opts.android) commands.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FileList repoId="r1" status={status()} open={null} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  return { commands, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

const row = (path: string, section = "unstaged") =>
  document.querySelector(`[data-section="${section}"][data-path="${path}"]`) as HTMLElement;
const treeRow = (path: string) =>
  screen.getAllByRole("treeitem").find((i) => i.getAttribute("data-path") === path)!;

async function openMenu(target: HTMLElement) {
  fireEvent.contextMenu(target);
  return screen.findByRole("menu");
}

const item = (name: string | RegExp) => screen.getByRole("menuitem", { name });
const maybe = (name: string | RegExp) => screen.queryByRole("menuitem", { name });

async function openIgnore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(item("Ignore"));
  await screen.findByRole("menuitem", { name: /Ignore (this file|folder|\d+ files)/ });
}

beforeEach(() => {
  window.localStorage.clear();
  useHistoryViews.setState({ view: null });
  vi.clearAllMocks();
  (save as unknown as Fn).mockReset();
});

describe("menu items by context", () => {
  it("groups every action for an unstaged file", async () => {
    await setup();
    const menu = await openMenu(row("src/a.ts"));
    for (const name of [
      /^Stage/,
      /Discard changes/,
      "Ignore",
      "Open diff in external tool",
      /Create patch/,
      "Copy patch",
      "File history",
      /Copy path/,
    ]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    }
    expect(within(menu).getAllByRole("separator").length).toBeGreaterThanOrEqual(3);
  });

  it("labels the extension item with the real extension", async () => {
    const { user } = await setup();
    await openMenu(row("src/a.ts"));
    await openIgnore(user);
    expect(item("Ignore this file")).toBeInTheDocument();
    expect(item("Ignore all *.ts files")).toBeInTheDocument();
    expect(item("Add to .git/info/exclude (local only)")).toBeInTheDocument();
    expect(item("Add *.ts to .git/info/exclude")).toBeInTheDocument();
  });

  it("hides the extension item for files without one", async () => {
    const { user } = await setup();
    await openMenu(row("Makefile"));
    await openIgnore(user);
    expect(maybe(/Ignore all/)).toBeNull();
    expect(maybe(/Add \*\./)).toBeNull();
  });

  it("offers Unstage, no Discard and the staged diff for the staged list", async () => {
    const { commands } = await setup();
    await openMenu(row("lib/c.log", "staged"));
    expect(item(/^Unstage/)).toBeInTheDocument();
    expect(maybe(/Discard changes/)).toBeNull();
    fireEvent.click(item("Open diff in external tool"));
    await waitFor(() =>
      expect(commands.difftoolOpen).toHaveBeenCalledWith("r1", "lib/c.log", true),
    );
  });

  it("hides the external diff for untracked files", async () => {
    await setup();
    await openMenu(row("notes.txt"));
    expect(maybe("Open diff in external tool")).toBeNull();
    expect(item("Copy patch")).toBeInTheDocument();
  });

  it("hides write and desktop-only actions when read-only", async () => {
    const { commands } = await setup({ android: true });
    await openMenu(row("src/a.ts"));
    await waitFor(() => expect(maybe("Ignore")).toBeNull());
    expect(maybe(/Discard changes/)).toBeNull();
    expect(maybe("Open diff in external tool")).toBeNull();
    expect(maybe(/Create patch/)).toBeNull();
    expect(maybe("File history")).toBeNull();
    expect(item("Copy patch")).toBeInTheDocument();
    expect(item(/Copy path/)).toBeInTheDocument();
    expect(commands.ignoreAdd).not.toHaveBeenCalled();
  });

  it("offers folder actions in the tree, without extension or history items", async () => {
    const { user } = await setup({ mode: "tree" });
    await openMenu(treeRow("src"));
    expect(maybe("File history")).toBeNull();
    await openIgnore(user);
    expect(item("Ignore folder")).toBeInTheDocument();
    expect(maybe(/Ignore all/)).toBeNull();
  });
});

describe("ignore", () => {
  it("adds an anchored file pattern and toasts it", async () => {
    const { commands, user } = await setup();
    await openMenu(row("src/a.ts"));
    await openIgnore(user);
    fireEvent.click(item("Ignore this file"));
    await waitFor(() =>
      expect(commands.ignoreAdd).toHaveBeenCalledWith("r1", ["/src/a.ts"], "gitignore", false),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Added /src/a.ts to .gitignore"),
    );
  });

  it("adds *.ext and the local exclude variants", async () => {
    const { commands, user } = await setup();
    await openMenu(row("src/a.ts"));
    await openIgnore(user);
    fireEvent.click(item("Ignore all *.ts files"));
    await waitFor(() =>
      expect(commands.ignoreAdd).toHaveBeenLastCalledWith("r1", ["*.ts"], "gitignore", false),
    );
    await openMenu(row("src/a.ts"));
    await openIgnore(user);
    fireEvent.click(item("Add to .git/info/exclude (local only)"));
    await waitFor(() =>
      expect(commands.ignoreAdd).toHaveBeenLastCalledWith("r1", ["/src/a.ts"], "exclude", false),
    );
  });

  it("ignores a folder with a trailing slash", async () => {
    const { commands, user } = await setup({ mode: "tree" });
    await openMenu(treeRow("src"));
    await openIgnore(user);
    fireEvent.click(item("Ignore folder"));
    await waitFor(() =>
      expect(commands.ignoreAdd).toHaveBeenCalledWith("r1", ["/src/"], "gitignore", false),
    );
  });

  it("applies to the whole selection", async () => {
    const { commands, user } = await setup();
    await user.click(row("src/a.ts"));
    await user.keyboard("{Control>}");
    await user.click(row("src/new.ts"));
    await user.keyboard("{/Control}");
    await openMenu(row("src/new.ts"));
    await openIgnore(user);
    expect(maybe(/Ignore all/)).not.toBeNull();
    fireEvent.click(item("Ignore 2 files"));
    await waitFor(() =>
      expect(commands.ignoreAdd).toHaveBeenCalledWith(
        "r1",
        ["/src/a.ts", "/src/new.ts"],
        "gitignore",
        false,
      ),
    );
  });

  it("offers to stop tracking files that are already tracked, only on request", async () => {
    const { commands, user } = await setup();
    commands.ignoreAdd.mockImplementation(() =>
      ok({ file: ".gitignore", added: ["/src/a.ts"], alreadyPresent: [], tracked: ["src/a.ts"] }),
    );
    await openMenu(row("src/a.ts"));
    await openIgnore(user);
    fireEvent.click(item("Ignore this file"));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(commands.untrackPaths).not.toHaveBeenCalled();
    const opts = (toast.warning as unknown as Fn).mock.calls[0]![1] as {
      action: { label: string; onClick: () => void };
    };
    expect(opts.action.label).toBe("Also stop tracking");
    opts.action.onClick();
    await waitFor(() =>
      expect(commands.untrackPaths).toHaveBeenCalledWith("r1", ["src/a.ts"], false),
    );
  });

  it("reports a pattern that is already present", async () => {
    const { commands, user } = await setup();
    commands.ignoreAdd.mockImplementation(() =>
      ok({ file: ".gitignore", added: [], alreadyPresent: ["/src/a.ts"], tracked: [] }),
    );
    await openMenu(row("src/a.ts"));
    await openIgnore(user);
    fireEvent.click(item("Ignore this file"));
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Already in .gitignore: /src/a.ts"),
    );
  });
});

describe("discard a folder", () => {
  async function openFolderDiscard() {
    const ctx = await setup({ mode: "tree" });
    await openMenu(treeRow("src"));
    fireEvent.click(item(/Discard changes/));
    const dialog = await screen.findByRole("alertdialog");
    return { ...ctx, dialog };
  }

  it("keeps untracked files unless the box is ticked", async () => {
    const { commands, user, dialog } = await openFolderDiscard();
    expect(commands.discardPaths).toHaveBeenCalledWith("r1", ["src/a.ts"], true);
    expect(within(dialog).getByText("src/a.ts")).toBeInTheDocument();
    const box = within(dialog).getByRole("checkbox", { name: "Also delete 1 untracked file" });
    expect(box).not.toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(commands.discardPaths).toHaveBeenLastCalledWith("r1", ["src/a.ts"], false),
    );
  });

  it("deletes untracked files when opted in", async () => {
    const { commands, user, dialog } = await openFolderDiscard();
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(commands.discardPaths).toHaveBeenLastCalledWith(
        "r1",
        ["src/a.ts", "src/new.ts"],
        false,
      ),
    );
  });
});

describe("patch", () => {
  it("saves a patch through the save dialog with the default name", async () => {
    const { commands } = await setup();
    (save as unknown as Fn).mockResolvedValue("/tmp/a.ts.patch");
    await openMenu(row("src/a.ts"));
    fireEvent.click(item(/Create patch/));
    await waitFor(() =>
      expect(commands.diffPatchSave).toHaveBeenCalledWith(
        "r1",
        ["src/a.ts"],
        false,
        "/tmp/a.ts.patch",
      ),
    );
    expect((save as unknown as Fn).mock.calls[0]![0]).toMatchObject({ defaultPath: "a.ts.patch" });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Patch saved to /tmp/a.ts.patch"),
    );
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    const { commands } = await setup();
    (save as unknown as Fn).mockResolvedValue(null);
    await openMenu(row("src/a.ts"));
    fireEvent.click(item(/Create patch/));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(commands.diffPatchSave).not.toHaveBeenCalled();
  });

  it("uses the folder path and the staged side", async () => {
    const { commands } = await setup({ mode: "tree" });
    (save as unknown as Fn).mockResolvedValue("/tmp/lib.patch");
    await openMenu(treeRow("lib"));
    fireEvent.click(item(/Create patch/));
    await waitFor(() =>
      expect(commands.diffPatchSave).toHaveBeenCalledWith("r1", ["lib"], true, "/tmp/lib.patch"),
    );
    expect((save as unknown as Fn).mock.calls[0]![0]).toMatchObject({ defaultPath: "lib.patch" });
  });

  it("copies the patch to the clipboard", async () => {
    const { commands } = await setup();
    await openMenu(row("src/a.ts"));
    fireEvent.click(item("Copy patch"));
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe("diff --git a/x b/x\n"),
    );
    expect(commands.diffPatch).toHaveBeenCalledWith("r1", ["src/a.ts"], false);
  });

  it("says so when there is nothing to copy", async () => {
    const { commands } = await setup();
    commands.diffPatch.mockImplementation(() => ok(""));
    await openMenu(row("src/a.ts"));
    fireEvent.click(item("Copy patch"));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("There are no changes to copy"));
    expect(await navigator.clipboard.readText()).toBe("");
  });
});

describe("external diff and history", () => {
  it("opens the unstaged diff in the external tool", async () => {
    const { commands } = await setup();
    await openMenu(row("src/a.ts"));
    fireEvent.click(item("Open diff in external tool"));
    await waitFor(() =>
      expect(commands.difftoolOpen).toHaveBeenCalledWith("r1", "src/a.ts", false),
    );
  });

  it("explains a missing diff tool with a link to the settings", async () => {
    const { commands } = await setup();
    commands.difftoolOpen.mockImplementation(() =>
      fail("invalidInput", "No diff tool is configured. Set one with `git config`."),
    );
    await openMenu(row("src/a.ts"));
    fireEvent.click(item("Open diff in external tool"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const [title, opts] = (toast.error as unknown as Fn).mock.calls[0]! as [
      string,
      { description: string; action: { label: string } },
    ];
    expect(title).toBe("Could not open the diff tool");
    expect(opts.description).toContain("No diff tool is configured");
    expect(opts.action.label).toBe("Git settings");
  });

  it("opens the file history view", async () => {
    await setup();
    await openMenu(row("src/a.ts"));
    fireEvent.click(item("File history"));
    expect(useHistoryViews.getState().view).toEqual({
      kind: "history",
      repoId: "r1",
      path: "src/a.ts",
    });
  });
});
