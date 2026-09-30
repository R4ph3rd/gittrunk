import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomShims, oid, renderApp, resetStore } from "@/app/testing";
import { useOperationsStore } from "@/stores/operations";
import { useRepoStore } from "@/stores/repo";
import { ConflictResolver } from "./conflicts/ConflictResolver";
import { OPEN_REBASE_EDITOR_EVENT } from "./OperationsHost";
import {
  conflictFile,
  installCodeMirrorShims,
  installOpsBackend,
  viewIn,
  type OpsBackend,
} from "./testing";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));
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
installCodeMirrorShims();

let backend: OpsBackend;

beforeEach(async () => {
  vi.clearAllMocks();
  resetStore();
  useOperationsStore.getState().reset();
  backend = await installOpsBackend();
});

async function openRepo() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderApp();
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("grid", { name: "Commit graph" });
  return user;
}

const banner = () => screen.findByRole("region", { name: "Operation in progress" });
const resultView = () => viewIn(screen.getByTestId("result-editor"));
const resultText = () => resultView().state.doc.toString();

describe("operation banner", () => {
  it("is hidden when the repository is clean", async () => {
    await openRepo();
    await screen.findByText("Commit number 0");
    expect(screen.queryByRole("region", { name: "Operation in progress" })).toBeNull();
  });

  it("describes a merge with conflicts and disables Continue", async () => {
    backend.setOperation("merge", ["src/a.ts", "src/b.ts"]);
    await openRepo();
    const region = await banner();
    expect(within(region).getByTestId("operation-title")).toHaveTextContent("Merging into main");
    expect(await within(region).findByText("2 conflicted files")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(within(region).queryByRole("button", { name: "Skip" })).toBeNull();
    expect(within(region).getByRole("button", { name: "Abort" })).toBeEnabled();
  });

  it.each([
    ["rebase", "Rebasing"],
    ["rebaseInteractive", "Interactive rebase in progress"],
    ["cherryPick", "Cherry-picking"],
    ["revert", "Reverting"],
  ] as const)("shows %s with Skip", async (state, title) => {
    backend.setOperation(state);
    await openRepo();
    const region = await banner();
    expect(within(region).getByTestId("operation-title")).toHaveTextContent(title);
    expect(within(region).getByRole("button", { name: "Skip" })).toBeInTheDocument();
    await waitFor(() =>
      expect(within(region).getByRole("button", { name: "Continue" })).toBeEnabled(),
    );
  });

  it("continues, skips and reports the outcome", async () => {
    backend.setOperation("rebase");
    const user = await openRepo();
    const region = await banner();
    await waitFor(() =>
      expect(within(region).getByRole("button", { name: "Continue" })).toBeEnabled(),
    );
    await user.click(within(region).getByRole("button", { name: "Continue" }));
    expect(backend.commands.sequencerControl).toHaveBeenCalledWith("r1", "continue");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await user.click(within(region).getByRole("button", { name: "Skip" }));
    expect(backend.commands.sequencerControl).toHaveBeenLastCalledWith("r1", "skip");
  });

  it("warns when continuing hits new conflicts", async () => {
    backend.setOperation("rebase");
    backend.commands.sequencerControl!.mockImplementation(() =>
      Promise.resolve({
        status: "ok",
        data: { kind: "conflicted", oplogId: "o", files: ["src/a.ts"] },
      }),
    );
    const user = await openRepo();
    const region = await banner();
    await waitFor(() =>
      expect(within(region).getByRole("button", { name: "Continue" })).toBeEnabled(),
    );
    await user.click(within(region).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
  });

  it("asks for confirmation before aborting", async () => {
    backend.setOperation("merge");
    const user = await openRepo();
    const region = await banner();
    await user.click(within(region).getByRole("button", { name: "Abort" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(backend.commands.sequencerControl).not.toHaveBeenCalled();

    await user.click(within(region).getByRole("button", { name: "Abort" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Abort operation",
      }),
    );
    expect(backend.commands.sequencerControl).toHaveBeenCalledWith("r1", "abort");
  });
});

describe("conflict resolver", () => {
  async function openResolver(file = conflictFile()) {
    backend.commands.conflictFile!.mockImplementation(() =>
      Promise.resolve({ status: "ok", data: file }),
    );
    backend.setOperation("merge", [file.path]);
    const user = await openRepo();
    const region = await banner();
    await user.click(await within(region).findByRole("button", { name: file.path }));
    await screen.findByTestId("result-editor");
    return user;
  }

  it("opens from the banner with the merged text and per-block actions", async () => {
    await openResolver();
    expect(resultText()).toContain("<<<<<<< HEAD");
    expect(screen.getByTestId("conflicts-remaining")).toHaveTextContent("2 conflicts remaining");
    expect(screen.getAllByRole("button", { name: "Accept ours" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Accept base" })).toBeNull();
    expect(screen.queryByRole("button", { name: /suggest resolution/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark resolved" })).toBeDisabled();
  });

  it("accepts ours / theirs per block and marks resolved with the content", async () => {
    const user = await openResolver();
    await user.click(screen.getAllByRole("button", { name: "Accept ours" })[0]!);
    expect(screen.getByTestId("conflicts-remaining")).toHaveTextContent("1 conflict remaining");
    expect(screen.getByRole("button", { name: "Mark resolved" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Accept theirs" }));
    expect(resultText()).toBe("top\nours line\nmiddle\ntheirs two\nbottom");
    expect(screen.getByTestId("conflicts-remaining")).toHaveTextContent("No conflicts remaining");

    await user.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(backend.commands.conflictResolve).toHaveBeenCalledWith("r1", "src/a.ts", {
      kind: "content",
      content: "top\nours line\nmiddle\ntheirs two\nbottom",
    });
    await waitFor(() => expect(screen.queryByTestId("result-editor")).toBeNull());
  });

  it("accepts both (ours then theirs)", async () => {
    const user = await openResolver();
    await user.click(screen.getAllByRole("button", { name: "Accept both" })[0]!);
    expect(resultText()).toContain("top\nours line\ntheirs line\nmiddle");
  });

  it("accepts base with diff3 markers", async () => {
    const merged = "a\n<<<<<<< HEAD\nours\n||||||| base\norig\n=======\ntheirs\n>>>>>>> f\nb";
    const user = await openResolver(conflictFile({ merged }));
    await user.click(screen.getByRole("button", { name: "Accept base" }));
    expect(resultText()).toBe("a\norig\nb");
  });

  it("preserves CRLF line endings when saving", async () => {
    const merged = "a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> f\r\nb";
    const user = await openResolver(conflictFile({ merged }));
    await user.click(screen.getByRole("button", { name: "Accept ours" }));
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(backend.commands.conflictResolve).toHaveBeenCalledWith("r1", "src/a.ts", {
      kind: "content",
      content: "a\r\nours\r\nb",
    });
  });

  it("lets the user override with a confirmation while markers remain", async () => {
    const user = await openResolver();
    await user.click(screen.getByRole("button", { name: "Mark resolved anyway…" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Mark resolved anyway",
      }),
    );
    const call = backend.commands.conflictResolve!.mock.calls[0]!;
    expect((call[2] as { content: string }).content).toContain("<<<<<<< HEAD");
  });

  it("navigates conflicts with alt+down and alt+up", async () => {
    await openResolver();
    const view = resultView();
    const content = view.contentDOM;
    view.focus();
    fireEvent.keyDown(content, { key: "ArrowDown", altKey: true });
    const first = resultText().indexOf("<<<<<<<");
    expect(view.state.selection.main.head).toBe(first);
    fireEvent.keyDown(content, { key: "ArrowDown", altKey: true });
    expect(view.state.selection.main.head).toBe(resultText().lastIndexOf("<<<<<<<"));
    fireEvent.keyDown(content, { key: "ArrowUp", altKey: true });
    expect(view.state.selection.main.head).toBe(first);
  });

  it("resolves a whole file with Use ours / Use theirs", async () => {
    const user = await openResolver();
    await user.click(screen.getByRole("button", { name: "Use theirs" }));
    expect(backend.commands.conflictResolve).toHaveBeenCalledWith("r1", "src/a.ts", {
      kind: "theirs",
    });
  });

  it("offers only Use ours / Use theirs for binary files", async () => {
    backend.commands.conflictFile!.mockImplementation(() =>
      Promise.resolve({
        status: "ok",
        data: conflictFile({ binary: true, base: null, ours: null, theirs: null, merged: "" }),
      }),
    );
    backend.setOperation("merge", ["logo.png"]);
    const user = await openRepo();
    await user.click(await within(await banner()).findByRole("button", { name: "logo.png" }));
    expect(await screen.findByRole("button", { name: "Use ours" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use theirs" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
    expect(screen.queryByTestId("result-editor")).toBeNull();
  });

  it("opens from a conflicted row in the staging panel", async () => {
    backend.setOperation("merge", ["src/a.ts"]);
    const user = await openRepo();
    await banner();
    act(() => useRepoStore.getState().selectWip("r1"));
    const row = await screen.findByRole("option", { name: /src\/a\.ts/ });
    await user.click(row);
    expect(await screen.findByTestId("result-editor")).toBeInTheDocument();
  });

  it("offers Suggest resolution through the app once AI is enabled", async () => {
    const c = backend.commands as Record<string, ReturnType<typeof vi.fn>>;
    c.aiSettingsGet!.mockImplementation(() =>
      Promise.resolve({
        status: "ok",
        data: {
          enabled: true,
          provider: "anthropic",
          model: "m",
          baseUrl: null,
          maxDiffBytes: 1000,
          hasKey: true,
        },
      }),
    );
    backend.commands.conflictFile!.mockImplementation(() =>
      Promise.resolve({ status: "ok", data: conflictFile() }),
    );
    backend.setOperation("merge", ["src/a.ts"]);
    const user = await openRepo();
    await banner();
    act(() => useRepoStore.getState().selectWip("r1"));
    await user.click(await screen.findByRole("option", { name: /src\/a\.ts/ }));
    expect(await screen.findByRole("button", { name: /suggest resolution/i })).toBeInTheDocument();
  });

  it("shows Suggest resolution only when a suggest function is provided", async () => {
    backend.commands.conflictFile!.mockImplementation(() =>
      Promise.resolve({ status: "ok", data: conflictFile() }),
    );
    const suggest = vi.fn(() => Promise.resolve("top\nsuggested\nbottom"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ConflictResolver repoId="r1" path="src/a.ts" onClose={() => undefined} suggest={suggest} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /suggest resolution/i }));
    await waitFor(() => expect(resultText()).toBe("top\nsuggested\nbottom"));
    expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ path: "src/a.ts" }));
    view.unmount();
  });
});

describe("interactive rebase editor", () => {
  async function openEditor() {
    const user = await openRepo();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(OPEN_REBASE_EDITOR_EVENT, { detail: { repoId: "r1", base: oid(9) } }),
      );
    });
    const list = await screen.findByRole("list", { name: "Rebase todo" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    return { user, list };
  }
  const rows = (list: HTMLElement) => within(list).getAllByRole("listitem");
  const oids = (list: HTMLElement) => rows(list).map((r) => r.id.replace("rebase-row-", ""));

  it("loads the todo for the base when the open event fires", async () => {
    const { list } = await openEditor();
    expect(backend.commands.rebaseTodoLoad).toHaveBeenCalledWith("r1", oid(9));
    expect(oids(list)).toEqual([oid(3), oid(2), oid(1)]);
  });

  it("ignores the event for another repository", async () => {
    await openRepo();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(OPEN_REBASE_EDITOR_EVENT, { detail: { repoId: "other", base: oid(9) } }),
      );
    });
    expect(screen.queryByRole("list", { name: "Rebase todo" })).toBeNull();
  });

  it("reorders a row with alt+arrow keys", async () => {
    const { list } = await openEditor();
    const first = rows(list)[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown", altKey: true });
    expect(oids(list)).toEqual([oid(2), oid(3), oid(1)]);
    await waitFor(() => expect(document.activeElement?.id).toBe(`rebase-row-${oid(3)}`));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp", altKey: true });
    expect(oids(list)).toEqual([oid(2), oid(3), oid(1)]);
  });

  it("changes the action with p r e s f d shortcuts", async () => {
    const { list } = await openEditor();
    const row = () => rows(list)[1]!;
    for (const [key, action] of [
      ["d", "drop"],
      ["r", "reword"],
      ["e", "edit"],
      ["s", "squash"],
      ["f", "fixup"],
      ["p", "pick"],
    ] as const) {
      fireEvent.keyDown(row(), { key });
      expect(row()).toHaveAttribute("data-action", action);
    }
  });

  it("strikes dropped commits through", async () => {
    const { list } = await openEditor();
    fireEvent.keyDown(rows(list)[2]!, { key: "d" });
    expect(within(rows(list)[2]!).getByText("Commit number 1")).toHaveClass("line-through");
  });

  it("squashes into the previous commit with the button", async () => {
    const { user, list } = await openEditor();
    expect(
      within(rows(list)[0]!).getByRole("button", { name: /squash .* into previous/i }),
    ).toBeDisabled();
    await user.click(
      within(rows(list)[1]!).getByRole("button", { name: /squash .* into previous/i }),
    );
    expect(rows(list)[1]).toHaveAttribute("data-action", "squash");
  });

  it("rejects a leading squash and an all-dropped todo without calling the backend", async () => {
    const { user, list } = await openEditor();
    fireEvent.keyDown(rows(list)[0]!, { key: "s" });
    await user.click(screen.getByRole("button", { name: "Start rebase" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /first kept commit cannot be squash/i,
    );

    for (const r of rows(list)) fireEvent.keyDown(r, { key: "d" });
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/keep at least one commit/i);
    expect(backend.commands.rebaseInteractive).not.toHaveBeenCalled();
  });

  it("previews with dryRun and starts with the exact todo", async () => {
    const { user, list } = await openEditor();
    // 3 pick, 2 reword (edited), 1 squash into it.
    fireEvent.keyDown(rows(list)[1]!, { key: "r" });
    const box = await within(rows(list)[1]!).findByRole("textbox");
    await waitFor(() => expect(box).toHaveValue("Details for 2\n\nBody text"));
    await user.clear(box);
    await user.type(box, "Reworded");
    fireEvent.keyDown(rows(list)[2]!, { key: "s" });
    const squashBox = await within(rows(list)[2]!).findByRole("textbox");
    await waitFor(() => expect(squashBox).toHaveValue("Reworded\n\nDetails for 1\n\nBody text"));

    const todo = [
      { action: "pick", oid: oid(3), summary: "Commit number 3", message: null },
      { action: "reword", oid: oid(2), summary: "Commit number 2", message: "Reworded" },
      {
        action: "squash",
        oid: oid(1),
        summary: "Commit number 1",
        message: "Reworded\n\nDetails for 1\n\nBody text",
      },
    ];

    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(backend.commands.rebaseInteractive).toHaveBeenLastCalledWith(
      "r1",
      { base: oid(9), todo },
      true,
    );
    expect(await screen.findByTestId("rebase-preview")).toHaveTextContent(
      "2 commit(s) will be created",
    );
    expect(screen.getByTestId("rebase-preview")).toHaveTextContent("src/a.ts");

    await user.click(screen.getByRole("button", { name: "Start rebase" }));
    expect(backend.commands.rebaseInteractive).toHaveBeenLastCalledWith(
      "r1",
      { base: oid(9), todo },
      false,
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("list", { name: "Rebase todo" })).toBeNull());
  });

  it("sends the reordered todo and explains an edit stop", async () => {
    const { user, list } = await openEditor();
    fireEvent.keyDown(rows(list)[2]!, { key: "e" });
    const last = rows(list)[2]!;
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowUp", altKey: true });
    await user.click(screen.getByRole("button", { name: "Start rebase" }));
    const request = backend.commands.rebaseInteractive!.mock.calls[0]![1] as {
      todo: { oid: string; action: string }[];
    };
    expect(request.todo.map((t) => [t.oid, t.action])).toEqual([
      [oid(3), "pick"],
      [oid(1), "edit"],
      [oid(2), "pick"],
    ]);
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/amend/i)));
  });

  it("closes and lets the banner take over when the rebase conflicts", async () => {
    backend.commands.rebaseInteractive!.mockImplementation(() =>
      Promise.resolve({
        status: "ok",
        data: { kind: "conflicted", oplogId: "o", files: ["src/a.ts"] },
      }),
    );
    const { user, list } = await openEditor();
    expect(rows(list)).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Start rebase" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Rebase todo" })).toBeNull());
    expect(toast.warning).toHaveBeenCalled();
  });
});
