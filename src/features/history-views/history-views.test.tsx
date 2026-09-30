import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomShims, ok, resetStore } from "@/app/testing";
import { TooltipProvider } from "@/design/components";
import { CommitDetailsPanel } from "@/features/repo/CommitDetailsPanel";
import { useRepoStore } from "@/stores/repo";
import { BlameView } from "./BlameView";
import { groupBlame } from "./blameGroups";
import { HistoryViewsHost } from "./HistoryViewsHost";
import { SubmodulesSection, WorktreesSection } from "./SidebarSections";
import { AddWorktreeDialog } from "./AddWorktreeDialog";
import { installHistoryBackend, sampleBlame, sampleHistory, sha } from "./testing";
import { openBlame, openFileHistory, openReflog, useHistoryViews } from "./store";
import { validateWorktree } from "./validate";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("/work/picked")),
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

type Commands = Awaited<ReturnType<typeof installHistoryBackend>>;
let commands: Commands;

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  resetStore();
  useHistoryViews.setState({ view: null, prompt: null, addWorktreeFor: null });
  commands = await installHistoryBackend();
  vi.clearAllMocks();
  commands = await installHistoryBackend();
  useRepoStore.getState().addRepo({
    id: "r1",
    path: "/work/demo",
    name: "demo",
    head: { kind: "branch", name: "main", oid: sha(0) },
    state: "clean",
    isBare: false,
  });
});

describe("blame", () => {
  it("groups lines by hunk and shows the gutter on the first line only", async () => {
    const rows = groupBlame(sampleBlame.lines, sampleBlame.hunks);
    expect(rows.map((r) => r.first)).toEqual([true, false, true, true, false]);
    expect(rows.map((r) => r.hunkIndex)).toEqual([0, 0, 1, 2, 2]);

    wrap(<BlameView repoId="r1" path="src/lib.rs" rev={null} onReveal={() => {}} />);
    expect(await screen.findByText("Add one and two")).toBeInTheDocument();
    expect(screen.getAllByText("Ada")).toHaveLength(1);
    expect(screen.getAllByText(sha(11).slice(0, 7))).toHaveLength(1);
    expect(screen.getByText("fn two() {}")).toBeInTheDocument();
    expect(commands.blame).toHaveBeenCalledWith("r1", "src/lib.rs", null);
  });

  it("selects the hunk's commit in the graph when clicked", async () => {
    commands.graphFind!.mockImplementation(() => ok(4));
    wrap(<HistoryViewsHost repoId="r1" />);
    act(() => openBlame("r1", "src/lib.rs", sha(5)));
    await userEvent.click(await screen.findByText("Add three"));
    await waitFor(() =>
      expect(useRepoStore.getState().selection.r1).toEqual({ kind: "commit", oid: sha(12) }),
    );
    expect(commands.graphFind).toHaveBeenCalledWith("r1", sha(12));
    expect(commands.blame).toHaveBeenCalledWith("r1", "src/lib.rs", sha(5));
    await waitFor(() => expect(useHistoryViews.getState().view).toBeNull());
  });

  it("does not select a commit that is not in the graph", async () => {
    commands.graphFind!.mockImplementation(() => ok(null));
    wrap(<HistoryViewsHost repoId="r1" />);
    act(() => openBlame("r1", "src/lib.rs"));
    await userEvent.click(await screen.findByText("Add three"));
    await waitFor(() => expect(commands.graphFind).toHaveBeenCalled());
    expect(useRepoStore.getState().selection.r1 ?? null).toBeNull();
    expect(useHistoryViews.getState().view).not.toBeNull();
  });

  it("closes with Escape", async () => {
    wrap(<HistoryViewsHost repoId="r1" />);
    act(() => openBlame("r1", "src/lib.rs"));
    await screen.findByText("Add three");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(useHistoryViews.getState().view).toBeNull());
  });

  it("opens from a file row in commit details at the selected revision", async () => {
    useRepoStore.getState().selectCommit("r1", sha(7));
    wrap(<CommitDetailsPanel repoId="r1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Blame src/lib.rs" }));
    expect(useHistoryViews.getState().view).toEqual({
      kind: "blame",
      repoId: "r1",
      path: "src/lib.rs",
      rev: sha(7),
    });
  });
});

describe("file history", () => {
  it("shows the path at a commit when renamed and diffs the entry's path", async () => {
    wrap(<HistoryViewsHost repoId="r1" />);
    act(() => openFileHistory("r1", "src/new_name.rs"));
    await screen.findByText("Create module");
    expect(screen.getByText("as src/old_name.rs")).toBeInTheDocument();
    expect(screen.queryByText("as src/new_name.rs")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(commands.commitFileDiff).toHaveBeenCalledWith(
        "r1",
        sampleHistory[0]!.commit.oid,
        "src/new_name.rs",
        expect.anything(),
      ),
    );

    await userEvent.click(screen.getByText("Create module"));
    await waitFor(() =>
      expect(commands.commitFileDiff).toHaveBeenCalledWith(
        "r1",
        sampleHistory[1]!.commit.oid,
        "src/old_name.rs",
        expect.anything(),
      ),
    );
  });

  it("blames at the selected revision and reveals in the graph", async () => {
    commands.graphFind!.mockImplementation(() => ok(2));
    wrap(<HistoryViewsHost repoId="r1" />);
    act(() => openFileHistory("r1", "src/new_name.rs"));
    await screen.findByText("Create module");
    await userEvent.click(screen.getByText("Create module"));
    await userEvent.click(screen.getByRole("button", { name: "Blame at this revision" }));
    expect(useHistoryViews.getState().view).toMatchObject({
      kind: "blame",
      path: "src/old_name.rs",
      rev: sha(22),
    });
    act(() => openFileHistory("r1", "src/new_name.rs"));
    await userEvent.click(await screen.findByRole("button", { name: "Reveal in graph" }));
    await waitFor(() => expect(commands.graphFind).toHaveBeenCalledWith("r1", sha(21)));
  });
});

describe("reflog", () => {
  it("renders entries and reveals through graphFind", async () => {
    commands.graphFind!.mockImplementation(() => ok(1));
    wrap(<HistoryViewsHost repoId="r1" />);
    act(() => openReflog("r1", "HEAD"));
    expect(await screen.findByText("commit: second")).toBeInTheDocument();
    expect(screen.getByText("commit (initial): first")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: `Reveal ${sha(31).slice(0, 7)} in graph` }),
    );
    await waitFor(() => expect(commands.graphFind).toHaveBeenCalledWith("r1", sha(31)));
    expect(commands.reflog).toHaveBeenCalledWith("r1", "HEAD", expect.any(Number));
  });

  it("checks out through a dry run first", async () => {
    wrap(<HistoryViewsHost repoId="r1" />);
    act(() => openReflog("r1", "refs/heads/main"));
    await screen.findByText("commit: second");
    await userEvent.click(screen.getByRole("button", { name: `Checkout ${sha(31).slice(0, 7)}` }));
    await waitFor(() =>
      expect(commands.checkout).toHaveBeenCalledWith("r1", { kind: "commit", oid: sha(31) }, true),
    );
  });
});

describe("sidebar sections", () => {
  it("renders submodule statuses and runs updates", async () => {
    wrap(<SubmodulesSection repoId="r1" />);
    await screen.findByText("vendor-a");
    expect(screen.getByText("Uninitialized")).toBeInTheDocument();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByText("Modified")).toBeInTheDocument();
    expect(screen.getByText("Out of date")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByText("vendor-a"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Init & update" }));
    await waitFor(() =>
      expect(commands.submoduleUpdate).toHaveBeenCalledWith("r1", {
        paths: ["vendor/a"],
        init: true,
        recursive: false,
      }),
    );

    fireEvent.contextMenu(screen.getByText("vendor-b"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Update recursively" }));
    await waitFor(() =>
      expect(commands.submoduleUpdate).toHaveBeenLastCalledWith("r1", {
        paths: ["vendor/b"],
        init: true,
        recursive: true,
      }),
    );
  });

  it("opens a submodule as a repository", async () => {
    commands.repoOpen!.mockImplementation(() =>
      ok({
        id: "r2",
        path: "/work/demo/vendor/b",
        name: "b",
        head: { kind: "branch", name: "main", oid: sha(0) },
        state: "clean",
        isBare: false,
      }),
    );
    wrap(<SubmodulesSection repoId="r1" />);
    fireEvent.contextMenu(await screen.findByText("vendor-b"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Open as repository" }));
    await waitFor(() => expect(commands.repoOpen).toHaveBeenCalledWith("/work/demo/vendor/b"));
    expect(useRepoStore.getState().activeId).toBe("r2");
  });

  it("renders worktree badges and removes with confirmation and force for locked ones", async () => {
    wrap(<WorktreesSection repoId="r1" />);
    await screen.findByText("demo-feature");
    expect(screen.getAllByText("main")).toHaveLength(2); // badge and branch
    expect(screen.getByText("locked")).toBeInTheDocument();
    expect(screen.getByText("prunable")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByText("demo-feature"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove…" }));
    const dialog = await screen.findByRole("dialog");
    expect(commands.worktreeRemove).not.toHaveBeenCalled();
    expect(within(dialog).getByText("/work/demo-feature")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(commands.worktreeRemove).toHaveBeenCalledWith("r1", "/work/demo-feature", true),
    );
  });

  it("offers force after a failed removal", async () => {
    commands.worktreeRemove!.mockImplementationOnce(() =>
      Promise.resolve({
        status: "error",
        error: { kind: "git", message: "has local changes", detail: null },
      }),
    );
    wrap(<WorktreesSection repoId="r1" />);
    fireEvent.contextMenu(await screen.findByText("gone"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove…" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByText("has local changes")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox")).toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(commands.worktreeRemove).toHaveBeenLastCalledWith("r1", "/work/gone", true),
    );
  });
});

describe("add worktree", () => {
  it("validates fields", () => {
    const local = ["main", "feature"];
    expect(validateWorktree({ path: "", branch: "", createBranch: true }, local)).toEqual({
      path: expect.any(String),
      branch: expect.any(String),
    });
    expect(
      validateWorktree({ path: "/w", branch: "bad name", createBranch: true }, local).branch,
    ).toBeDefined();
    expect(
      validateWorktree({ path: "/w", branch: "main", createBranch: true }, local).branch,
    ).toMatch(/already exists/);
    expect(
      validateWorktree({ path: "/w", branch: "nope", createBranch: false }, local).branch,
    ).toMatch(/does not exist/);
    expect(validateWorktree({ path: "/w", branch: "feature", createBranch: false }, local)).toEqual(
      {},
    );
    expect(validateWorktree({ path: "/w", branch: "new/x", createBranch: true }, local)).toEqual(
      {},
    );
  });

  it("shows errors without calling the backend, then adds", async () => {
    const onClose = vi.fn();
    wrap(<AddWorktreeDialog repoId="r1" open onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add worktree" }));
    expect(await screen.findByText("Choose a folder for the worktree.")).toBeInTheDocument();
    expect(commands.worktreeAdd).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(screen.getByLabelText("Folder")).toHaveValue("/work/picked"));
    await userEvent.type(screen.getByLabelText("Branch"), "topic");
    await userEvent.click(screen.getByRole("button", { name: "Add worktree" }));
    await waitFor(() =>
      expect(commands.worktreeAdd).toHaveBeenCalledWith("r1", {
        path: "/work/picked",
        branch: "topic",
        createBranch: true,
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
