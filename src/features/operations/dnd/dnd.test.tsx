import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/design/components";
import { ThemeProvider } from "@/design/theme";
import { commands as realCommands, type OpOutcome } from "@/ipc/bindings";
import { fail, ok } from "@/app/mockBindings";
import {
  installBackend,
  installDomShims,
  oid,
  previewOutcome,
  renderApp,
  resetStore,
} from "@/app/testing";
import { useDndStore } from "@/stores/dnd";
import { useRepoStore } from "@/stores/repo";
import { buildActionEntries, type ActionContext } from "../actions/entries";
import type { ActionTarget } from "../actions/types";
import { resolveDrop } from "./resolve";
import type { DragSource, DropContext, DropTarget } from "./types";
import { buildMiniGraph } from "../preview/miniGraphModel";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));

installDomShims();
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
type Mock = ReturnType<typeof vi.fn>;
const commands = realCommands as unknown as Record<string, Mock> &
  Record<"merge" | "refsList" | "undo", Mock>;

const head = { kind: "branch", name: "main", oid: oid(0) } as const;
const ctx: DropContext = { head, onHead: new Set([oid(0), oid(1), oid(2)]) };
const branch = (name: string, extra: Partial<Extract<DragSource, { kind: "branch" }>> = {}) =>
  ({
    kind: "branch",
    name,
    fullName: `refs/heads/${name}`,
    remote: false,
    isHead: false,
    oid: oid(5),
    ...extra,
  }) as Extract<DragSource, { kind: "branch" }>;
const commit = (n: number, index = n): Extract<DragSource, { kind: "commit" }> => ({
  kind: "commit",
  oid: oid(n),
  shortOid: oid(n).slice(0, 7),
  index,
});
const labels = (s: DragSource, t: DropTarget, c = ctx) => resolveDrop(s, t, c).map((o) => o.label);

describe("drop resolution table", () => {
  it("offers merge strategies and rebase for branch onto branch", () => {
    expect(labels(branch("feature"), branch("main", { isHead: true }))).toEqual([
      "Merge feature into main",
      "Merge feature into main (no fast-forward)",
      "Merge feature into main (fast-forward only)",
      "Merge feature into main (squash)",
      "Rebase feature onto main",
    ]);
    const [merge] = resolveDrop(branch("feature"), branch("main", { isHead: true }), ctx);
    expect(merge?.action).toEqual({
      type: "merge",
      source: "feature",
      into: null,
      strategy: "auto",
    });
  });

  it("only offers merges from a remote branch and rejects remote or same targets", () => {
    expect(
      labels(branch("origin/x", { remote: true }), branch("main")).some((l) =>
        l.startsWith("Rebase"),
      ),
    ).toBe(false);
    expect(labels(branch("a"), branch("origin/x", { remote: true }))).toEqual([]);
    expect(labels(branch("a"), branch("a"))).toEqual([]);
  });

  it("cherry-picks a commit onto a local branch", () => {
    const [opt] = resolveDrop(commit(3), branch("release"), ctx);
    expect(opt?.label).toBe(`Cherry-pick ${oid(3).slice(0, 7)} onto release`);
    expect(opt?.action).toEqual({ type: "cherryPick", oid: oid(3), targetBranch: "release" });
    expect(labels(commit(3), branch("origin/x", { remote: true }))).toEqual([]);
  });

  it("moves a branch or tag to a commit and resets the checked-out branch", () => {
    const row: DropTarget = { kind: "commit", oid: oid(2), shortOid: oid(2).slice(0, 7), index: 2 };
    expect(labels(branch("feature"), row)).toEqual(["Move feature here"]);
    expect(labels({ kind: "tag", name: "v1", fullName: "refs/tags/v1", oid: oid(9) }, row)).toEqual(
      ["Move v1 here"],
    );
    const resets = resolveDrop(branch("main", { isHead: true }), row, ctx);
    expect(resets.map((r) => r.id)).toEqual(["reset:soft", "reset:mixed", "reset:hard"]);
    expect(resets.map((r) => !!r.destructive)).toEqual([false, false, true]);
    expect(labels(branch("origin/x", { remote: true }), row)).toEqual([]);
    expect(labels(branch("feature", { oid: oid(2) }), row)).toEqual([]);
  });

  it("offers interactive rebase only between two commits on the current branch", () => {
    const [opt] = resolveDrop(commit(0), commit(2), ctx);
    expect(opt?.action).toEqual({ type: "interactiveRebase", base: oid(2) });
    expect(resolveDrop(commit(0), commit(7), ctx)).toEqual([]);
    expect(resolveDrop(commit(0), commit(0), ctx)).toEqual([]);
  });
});

describe("context menu actions", () => {
  const perform = vi.fn();
  const prompt = vi.fn();
  const copy = vi.fn();
  const openRebaseEditor = vi.fn();
  const context: ActionContext = { repoId: "r1", head, perform, prompt, copy, openRebaseEditor };
  const find = (target: ActionTarget, id: string) => {
    const e = buildActionEntries(target, context).find((x) => x.kind === "item" && x.id === id);
    if (!e || e.kind !== "item") throw new Error(`no entry ${id}`);
    return e;
  };
  const commitTarget: ActionTarget = { kind: "commit", oid: oid(4), shortOid: oid(4).slice(0, 7) };

  beforeEach(() => {
    vi.clearAllMocks();
    commands.merge.mockImplementation(() => ok(previewOutcome("x")));
  });

  it("calls the right commands with the right requests", async () => {
    const cases: Array<[ActionTarget, string, string, unknown[]]> = [
      [
        commitTarget,
        "merge",
        "merge",
        ["r1", { source: oid(4), into: null, strategy: "auto", message: null }, true],
      ],
      [commitTarget, "rebase", "rebase", ["r1", { onto: oid(4), branch: null }, true]],
      [
        commitTarget,
        "cherryPick",
        "cherryPick",
        ["r1", { commits: [oid(4)], targetBranch: null, noCommit: false }, true],
      ],
      [commitTarget, "revert", "revert", ["r1", { commits: [oid(4)], noCommit: false }, true]],
      [commitTarget, "reset.hard", "reset", ["r1", { target: oid(4), mode: "hard" }, true]],
      [commitTarget, "checkout", "checkout", ["r1", { kind: "commit", oid: oid(4) }, true]],
      [{ kind: "tag", name: "v1", oid: oid(4) }, "deleteTag", "tagDelete", ["r1", "v1", true]],
      [
        {
          kind: "branch",
          name: "feature",
          fullName: "refs/heads/feature",
          remote: false,
          isHead: false,
          oid: oid(4),
        },
        "delete",
        "branchDelete",
        ["r1", { name: "feature", remote: false, force: false }, true],
      ],
    ];
    for (const [target, id, command, args] of cases) {
      commands[command]?.mockImplementation(() => ok(previewOutcome("x")));
      find(target, id).run();
      const spec = perform.mock.calls.at(-1)?.[0];
      await spec.run(true);
      expect(commands[command]).toHaveBeenLastCalledWith(...args);
    }
  });

  it("prompts for names, copies the sha and opens the rebase editor", () => {
    find(commitTarget, "createBranch").run();
    expect(prompt).toHaveBeenCalledWith({
      kind: "branch",
      repoId: "r1",
      startPoint: oid(4),
      label: oid(4).slice(0, 7),
    });
    find(commitTarget, "createTag").run();
    expect(prompt).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "tag", target: oid(4) }),
    );
    find(commitTarget, "copySha").run();
    expect(copy).toHaveBeenCalledWith(oid(4));
    find(commitTarget, "interactiveRebase").run();
    expect(openRebaseEditor).toHaveBeenCalledWith(oid(4));
  });
});

describe("mini graph model", () => {
  it("places refs before and after and marks unknown targets as created", () => {
    const rows = new Map([[oid(1), { index: 1 } as never]]);
    const model = buildMiniGraph(
      [{ name: "refs/heads/main", from: oid(1), to: oid(9) }],
      [{ oid: oid(2), shortOid: "2", summary: "x", authorName: "a", authorTime: 0 }],
      rows,
    );
    expect(model.before.map((n) => [n.kind, n.refs])).toEqual([
      ["dropped", []],
      ["existing", ["main"]],
    ]);
    expect(model.after).toMatchObject([{ kind: "created", refs: ["main"] }]);
  });
});

const drop = (
  overrides: Partial<Extract<OpOutcome, { kind: "preview" }>["preview"]>,
): OpOutcome => ({
  kind: "preview",
  preview: {
    summary: "Merge feature into main",
    refUpdates: [{ name: "refs/heads/main", from: oid(0), to: oid(9) }],
    commitsCreated: 1,
    commitsDropped: [],
    predictedConflicts: [],
    warnings: [],
    ...overrides,
  },
});

async function openWithBranches() {
  commands.refsList.mockImplementation(() =>
    ok({
      head,
      local: ["main", "feature"].map((name, i) => ({
        name,
        fullName: `refs/heads/${name}`,
        oid: oid(i),
        upstream: null,
        ahead: 0,
        behind: 0,
        isHead: i === 0,
        remote: null,
      })),
      remote: [],
      tags: [],
      stashes: [],
    }),
  );
  const user = userEvent.setup();
  renderApp();
  render(
    <ThemeProvider defaultTheme="dark">
      <Toaster />
    </ThemeProvider>,
  );
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByText("Commit number 0");
  return user;
}

describe("keyboard drag and drop and the confirmation flow", () => {
  beforeEach(async () => {
    resetStore();
    useDndStore.setState({ menu: null, confirm: null, prompt: null, drag: null, cursor: -1 });
    vi.clearAllMocks();
    await installBackend();
  });

  it("drags a branch onto another branch from the keyboard and offers the merge", async () => {
    const user = await openWithBranches();
    const sidebar = await screen.findByRole("navigation", { name: "References" });
    const feature = await within(sidebar).findByRole("button", { name: "feature" });
    act(() => feature.focus());
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("menuitem", { name: "Merge feature into main" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Rebase feature onto main" })).toBeInTheDocument();
  });

  it("shows every preview field, confirms with dryRun false and undoes", async () => {
    commands.merge.mockImplementation((_r: string, _q: unknown, dryRun: boolean) =>
      ok(
        dryRun
          ? drop({
              commitsDropped: [
                {
                  oid: oid(3),
                  shortOid: oid(3).slice(0, 7),
                  summary: "lost work",
                  authorName: "A",
                  authorTime: 1,
                },
              ],
              predictedConflicts: ["src/a.rs"],
              warnings: ["careful now"],
            })
          : { kind: "applied", oplogId: "o1", head, message: "Merged feature" },
      ),
    );
    const user = await openWithBranches();
    const { requestOperation } = await import("../preview/useConfirmedOperation");
    const { ops } = await import("../actions/ops");
    const { QueryClient } = await import("@tanstack/react-query");
    void requestOperation(
      new QueryClient(),
      ops.merge("r1", { source: "feature", into: null, strategy: "auto" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Merge feature into main");
    expect(within(dialog).getByRole("list", { name: "Ref updates" })).toHaveTextContent(
      `main${oid(0).slice(0, 7)} → ${oid(9).slice(0, 7)}`,
    );
    expect(within(dialog).getByText("Creates 1 commit")).toBeInTheDocument();
    expect(within(dialog).getByRole("list", { name: "Commits dropped" })).toHaveTextContent(
      "lost work",
    );
    expect(within(dialog).getByText("Conflicts predicted")).toBeInTheDocument();
    expect(within(dialog).getByRole("list", { name: "Predicted conflicts" })).toHaveTextContent(
      "src/a.rs",
    );
    expect(within(dialog).getByText("careful now")).toBeInTheDocument();
    expect(within(dialog).getByTestId("mini-graph")).toBeInTheDocument();
    expect(commands.merge).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Merge" }));
    await waitFor(() =>
      expect(commands.merge).toHaveBeenLastCalledWith("r1", expect.anything(), false),
    );
    // The toast's Undo action, not the toolbar's Undo button.
    const toolbar = screen.getByRole("toolbar", { name: "Remote operations" });
    const toastUndo = await waitFor(() => {
      const found = screen
        .getAllByRole("button", { name: "Undo" })
        .find((b) => !toolbar.contains(b));
      expect(found).toBeDefined();
      return found!;
    });
    await user.click(toastUndo);
    await waitFor(() => expect(commands.undo).toHaveBeenCalledWith("r1", false));
  });

  it("selects the WIP row when the operation conflicts", async () => {
    commands.merge.mockImplementation((_r: string, _q: unknown, dryRun: boolean) =>
      ok(dryRun ? drop({}) : { kind: "conflicted", oplogId: "o2", files: ["a.txt"] }),
    );
    await openWithBranches();
    const { requestOperation } = await import("../preview/useConfirmedOperation");
    const { ops } = await import("../actions/ops");
    const { QueryClient } = await import("@tanstack/react-query");
    void requestOperation(
      new QueryClient(),
      ops.merge("r1", { source: "feature", into: null, strategy: "auto" }),
    );
    const user = userEvent.setup();
    await user.click(
      await within(await screen.findByRole("alertdialog")).findByRole("button", { name: "Merge" }),
    );
    expect(await screen.findByText("Resolve conflicts to continue")).toBeInTheDocument();
    expect(useRepoStore.getState().selection["r1"]).toEqual({ kind: "wip" });
  });

  it("reports dry-run errors as a toast without opening a dialog", async () => {
    commands.merge.mockImplementation(() => fail("conflict", "cannot merge"));
    await openWithBranches();
    const { requestOperation } = await import("../preview/useConfirmedOperation");
    const { ops } = await import("../actions/ops");
    const { QueryClient } = await import("@tanstack/react-query");
    await requestOperation(
      new QueryClient(),
      ops.merge("r1", { source: "feature", into: null, strategy: "auto" }),
    );
    expect(await screen.findByText(/cannot merge/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
