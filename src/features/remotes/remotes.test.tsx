import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCommandStore } from "@/app/commands";
import { findConflicts } from "@/app/shortcuts";
import {
  emitCredentialRequested,
  emitOpFinished,
  emitOpProgress,
  installBackend,
  installDomShims,
  oid,
  ok,
  previewOutcome,
  renderApp,
  resetStore,
} from "@/app/testing";
import { fail } from "@/app/mockBindings";
import { useOpsStore } from "@/features/ops/store";
import type { BranchInfo, RefsSnapshot } from "@/ipc/bindings";
import { useRepoStore } from "@/stores/repo";
import { getPullStrategy } from "@/stores/settings";
import { useCredentialQueue } from "./credentials";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work")) }));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();
Element.prototype.scrollIntoView ??= () => {};

const branch = (parts: Partial<BranchInfo>): BranchInfo => ({
  name: "main",
  fullName: "refs/heads/main",
  oid: oid(0),
  upstream: null,
  ahead: 0,
  behind: 0,
  isHead: true,
  remote: null,
  ...parts,
});

const remoteFeature = branch({
  name: "origin/feature",
  fullName: "refs/remotes/origin/feature",
  isHead: false,
  remote: "origin",
});

function refs(local: BranchInfo[], remote: BranchInfo[] = []): RefsSnapshot {
  return {
    head: { kind: "branch", name: "main", oid: oid(0) },
    local,
    remote,
    tags: [],
    stashes: [],
  };
}

async function backend(
  snapshot = refs([branch({ upstream: "origin/main", ahead: 1, behind: 2 })]),
) {
  const commands = await installBackend();
  commands.refsList.mockImplementation(() => ok(snapshot));
  return commands;
}

async function openRepo() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const view = renderApp();
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("toolbar", { name: "Remote operations" });
  return { user, ...view };
}

const PULL = /^Pull(?! options| requests)/;
const PUSH = /^Push(?! options)/;
/** Radix menus open on pointerdown, which jsdom does not model; the keyboard path is equivalent. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  act(() => screen.getByRole("button", { name }).focus());
  await user.keyboard("{Enter}");
}

const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1];

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetStore();
  useCredentialQueue.getState().reset();
  useCommandStore.setState({ recent: [] });
});

describe("operation tracker", () => {
  it("tracks progress, finishes, invalidates queries and toasts", async () => {
    const commands = await backend();
    const { user } = await openRepo();
    await user.click(screen.getByRole("button", { name: /^Fetch/ }));

    expect(commands.fetch).toHaveBeenCalledWith("r1", { remote: null, prune: true, tags: false });
    expect(await screen.findByText("Fetching all remotes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Fetch/ })).toBeDisabled();

    act(() => emitOpProgress("op-fetch", "Receiving objects", 40));
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(useOpsStore.getState().ops["op-fetch"]?.phase).toBe("Receiving objects");

    const before = commands.refsList.mock.calls.length;
    act(() => emitOpFinished("op-fetch"));
    await waitFor(() => expect(useOpsStore.getState().ops).toEqual({}));
    expect(toast.success).toHaveBeenCalledWith("Fetch complete");
    await waitFor(() => expect(commands.refsList.mock.calls.length).toBeGreaterThan(before));
    expect(commands.graphLoad.mock.calls.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^Fetch/ })).toBeEnabled();
  });

  it("handles an op that finishes before its id is returned", async () => {
    const commands = await backend();
    commands.fetch.mockImplementation(() => {
      emitOpFinished("op-early");
      return ok("op-early");
    });
    const { user } = await openRepo();
    await user.click(screen.getByRole("button", { name: /^Fetch/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Fetch complete"));
    expect(useOpsStore.getState().ops).toEqual({});
  });

  it("cancels through opCancel and stays silent on cancelled", async () => {
    const commands = await backend();
    const { user } = await openRepo();
    await user.click(screen.getByRole("button", { name: /^Fetch/ }));
    await user.click(await screen.findByRole("button", { name: "Cancel Fetching all remotes" }));
    expect(commands.opCancel).toHaveBeenCalledWith("op-fetch");

    act(() =>
      emitOpFinished("op-fetch", {
        error: { kind: "cancelled", message: "Cancelled", detail: null },
      }),
    );
    await waitFor(() => expect(useOpsStore.getState().ops).toEqual({}));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("toasts errors with details and warns on conflicts", async () => {
    await backend();
    const { user } = await openRepo();
    await user.click(screen.getByRole("button", { name: /^Fetch/ }));
    await screen.findByText("Fetching all remotes");
    act(() =>
      emitOpFinished("op-fetch", {
        error: { kind: "network", message: "Could not resolve host", detail: "stderr text" },
      }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const [title, opts] = (toast.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(title).toBe("Fetching all remotes failed: Could not resolve host");
    expect(opts.description).toBeTruthy();

    await user.click(screen.getByRole("button", { name: PULL }));
    await screen.findByText(/Pulling main/);
    act(() =>
      emitOpFinished("op-pull", {
        outcome: { kind: "conflicted", oplogId: "o", files: ["a.txt", "b.txt"] },
      }),
    );
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("conflicts in 2 file(s)")),
    );
  });

  it("reports a failing start command", async () => {
    const commands = await backend();
    commands.fetch.mockImplementation(() => fail("gitCli", "git missing"));
    const { user } = await openRepo();
    await user.click(screen.getByRole("button", { name: /^Fetch/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Fetching all remotes failed: git missing"),
    );
    expect(useOpsStore.getState().ops).toEqual({});
  });
});

describe("toolbar", () => {
  it("shows ahead and behind counts", async () => {
    await backend();
    await openRepo();
    expect(screen.getByRole("button", { name: PULL })).toHaveTextContent("2");
    expect(screen.getByLabelText("2 behind")).toBeInTheDocument();
    expect(screen.getByLabelText("1 ahead")).toBeInTheDocument();
  });

  it("pulls with the default strategy and lets the dropdown change it", async () => {
    const commands = await backend();
    const { user } = await openRepo();
    await user.click(screen.getByRole("button", { name: PULL }));
    expect(commands.pull).toHaveBeenCalledWith("r1", {
      remote: "origin",
      branch: "main",
      strategy: "merge",
    });
    act(() => emitOpFinished("op-pull"));
    await waitFor(() => expect(useOpsStore.getState().ops).toEqual({}));

    await openMenu(user, "Pull options");
    await user.click(await screen.findByRole("menuitem", { name: "Rebase" }));
    await waitFor(() =>
      expect(lastCall(commands.pull)![1]).toEqual({
        remote: "origin",
        branch: "main",
        strategy: "rebase",
      }),
    );
    expect(getPullStrategy()).toBe("rebase");
  });

  it("pushes to the upstream", async () => {
    const commands = await backend();
    const { user } = await openRepo();
    await user.click(screen.getByRole("button", { name: PUSH }));
    await waitFor(() => expect(commands.push).toHaveBeenCalled());
    expect(commands.push).toHaveBeenCalledWith("r1", {
      remote: "origin",
      refspecs: ["refs/heads/main:refs/heads/main"],
      forceWithLease: false,
      setUpstream: false,
      tags: false,
    });
  });

  it("opens the upstream dialog when the branch has none", async () => {
    const commands = await backend(refs([branch({})]));
    const { user } = await openRepo();
    await user.click(screen.getByRole("button", { name: PUSH }));
    expect(commands.push).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "Push main" });
    expect(within(dialog).getByRole("radio", { name: "origin" })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Push and set upstream" }));
    await waitFor(() => expect(commands.push).toHaveBeenCalled());
    expect(commands.push).toHaveBeenCalledWith("r1", {
      remote: "origin",
      refspecs: ["refs/heads/main:refs/heads/main"],
      forceWithLease: false,
      setUpstream: true,
      tags: false,
    });
  });

  it("requires confirmation for force with lease", async () => {
    const commands = await backend();
    const { user } = await openRepo();
    await openMenu(user, "Push options");
    await user.click(await screen.findByRole("menuitem", { name: /Force push with lease/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(commands.push).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(commands.push).not.toHaveBeenCalled();

    await openMenu(user, "Push options");
    await user.click(await screen.findByRole("menuitem", { name: /Force push with lease/ }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Force push" }),
    );
    await waitFor(() => expect(commands.push).toHaveBeenCalled());
    expect(lastCall(commands.push)![1]).toMatchObject({ forceWithLease: true, setUpstream: false });
  });
});

describe("credential prompt", () => {
  it("responds with the value and remember flag", async () => {
    const commands = await backend();
    const { user } = await openRepo();
    act(() => emitCredentialRequested("req1", "password", "https://example.com/a.git", "ada"));
    const dialog = await screen.findByRole("dialog", { name: "Password required" });
    expect(within(dialog).getByText("https://example.com/a.git")).toBeInTheDocument();
    const field = within(dialog).getByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, "s3cret");
    await user.click(within(dialog).getByLabelText("Remember in system keychain"));
    await user.click(within(dialog).getByRole("button", { name: "Sign in" }));
    expect(commands.credentialRespond).toHaveBeenCalledWith("req1", "s3cret", true);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /required/ })).toBeNull());
  });

  it("prefills the username and responds null on cancel", async () => {
    const commands = await backend();
    const { user } = await openRepo();
    act(() => emitCredentialRequested("req2", "username", "https://example.com/a.git", "ada"));
    const dialog = await screen.findByRole("dialog", { name: "Username required" });
    const field = within(dialog).getByLabelText("Username");
    expect(field).toHaveValue("ada");
    expect(field).toHaveAttribute("type", "text");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(commands.credentialRespond).toHaveBeenCalledTimes(1);
    expect(commands.credentialRespond).toHaveBeenCalledWith("req2", null, false);
  });

  it("queues concurrent requests", async () => {
    const commands = await backend();
    const { user } = await openRepo();
    act(() => {
      emitCredentialRequested("a", "password");
      emitCredentialRequested("b", "passphrase");
    });
    const first = await screen.findByRole("dialog", { name: "Password required" });
    expect(within(first).getByText("1 more waiting")).toBeInTheDocument();
    await user.type(within(first).getByLabelText("Password"), "pw");
    await user.click(within(first).getByRole("button", { name: "Sign in" }));
    expect(commands.credentialRespond).toHaveBeenCalledWith("a", "pw", false);

    const second = await screen.findByRole("dialog", { name: "Passphrase required" });
    expect(within(second).getByLabelText("Passphrase")).toHaveValue("");
    await user.click(within(second).getByRole("button", { name: "Cancel" }));
    expect(commands.credentialRespond).toHaveBeenLastCalledWith("b", null, false);
  });
});

describe("remotes management", () => {
  it("validates the add remote form", async () => {
    const commands = await backend();
    const { user } = await openRepo();
    await user.click(screen.getByRole("button", { name: "Add remote" }));
    const dialog = await screen.findByRole("dialog", { name: "Add remote" });
    const name = within(dialog).getByLabelText("Name");
    const url = within(dialog).getByLabelText("URL");
    const submit = () => user.click(within(dialog).getByRole("button", { name: "Add remote" }));

    await submit();
    expect(within(dialog).getByText("Enter a name")).toBeInTheDocument();

    await user.type(name, "bad name");
    await user.type(url, "-oProxyCommand=x");
    await submit();
    expect(within(dialog).getByText(/Use letters, digits/)).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot start with a dash/)).toBeInTheDocument();
    expect(commands.remoteAdd).not.toHaveBeenCalled();

    await user.clear(name);
    await user.type(name, "up.stream-1");
    await user.clear(url);
    await user.type(url, "https://example.com/up.git");
    await submit();
    await waitFor(() => expect(commands.remoteAdd).toHaveBeenCalled());
    expect(commands.remoteAdd).toHaveBeenCalledWith("r1", {
      name: "up.stream-1",
      url: "https://example.com/up.git",
      fetch: true,
    });
  });

  it("merges and rebases onto a remote branch from its context menu", async () => {
    const commands = await backend(refs([branch({})], [remoteFeature]));
    const { user } = await openRepo();
    fireEvent.contextMenu(await screen.findByRole("button", { name: "feature" }));
    expect(await screen.findByRole("menuitem", { name: "Rebase main onto this" })).toBeVisible();
    await user.click(await screen.findByRole("menuitem", { name: "Merge into main" }));
    await waitFor(() => expect(commands.merge).toHaveBeenCalled());
    expect(commands.merge.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ source: "origin/feature" }),
    );
    expect(commands.merge.mock.calls[0]![2]).toBe(true); // dry run first
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("checks out and deletes a remote branch from its context menu", async () => {
    const commands = await backend(refs([branch({})], [remoteFeature]));
    const { user } = await openRepo();
    const item = await screen.findByRole("button", { name: "feature" });

    fireEvent.contextMenu(item);
    await user.click(await screen.findByRole("menuitem", { name: "Checkout as local branch" }));
    await waitFor(() => expect(commands.checkout).toHaveBeenCalled());
    expect(commands.checkout).toHaveBeenCalledWith(
      "r1",
      { kind: "remoteBranch", name: "origin/feature", localName: "feature" },
      false,
    );

    commands.branchDelete.mockImplementation((_r: string, _q: unknown, dryRun: boolean) =>
      ok(dryRun ? previewOutcome("Will delete origin/feature") : previewOutcome("done")),
    );
    fireEvent.contextMenu(item);
    await user.click(await screen.findByRole("menuitem", { name: "Delete remote branch" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Will delete origin/feature")).toBeInTheDocument();
    expect(commands.branchDelete).toHaveBeenCalledTimes(1);
    expect(commands.branchDelete.mock.calls[0]![2]).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(commands.branchDelete).toHaveBeenCalledTimes(2));
    expect(commands.branchDelete).toHaveBeenLastCalledWith(
      "r1",
      { name: "origin/feature", remote: true, force: false },
      false,
    );
  });

  it("removes a remote only after confirmation", async () => {
    const commands = await backend();
    const { user } = await openRepo();
    fireEvent.contextMenu(await screen.findByRole("button", { name: "Remote origin" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(commands.remoteRemove).not.toHaveBeenCalled();
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }),
    );
    await waitFor(() => expect(commands.remoteRemove).toHaveBeenCalledWith("r1", "origin"));
  });

  it("sets the upstream of a local branch", async () => {
    const commands = await backend(refs([branch({})], [remoteFeature]));
    const { user } = await openRepo();
    fireEvent.contextMenu(await screen.findByRole("button", { name: "main" }));
    await user.click(await screen.findByRole("menuitem", { name: "Set upstream…" }));
    const dialog = await screen.findByRole("dialog", { name: "Set upstream for main" });
    await user.selectOptions(within(dialog).getByLabelText("Upstream"), "origin/feature");
    await user.click(within(dialog).getByRole("button", { name: "Set upstream" }));
    await waitFor(() =>
      expect(commands.setUpstream).toHaveBeenCalledWith("r1", "main", "origin/feature"),
    );
  });
});

describe("clone", () => {
  it("clones, tracks the op and opens the repository", async () => {
    const commands = await backend();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Clone repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Clone repository" });
    await user.type(
      within(dialog).getByLabelText("Repository URL"),
      "https://github.com/acme/widgets.git",
    );
    await user.click(within(dialog).getByRole("button", { name: "Browse" }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Destination")).toHaveValue("/work/widgets"),
    );
    await user.click(within(dialog).getByLabelText("Recurse submodules"));
    await user.click(within(dialog).getByRole("button", { name: "Clone" }));

    expect(commands.repoClone).toHaveBeenCalledWith({
      url: "https://github.com/acme/widgets.git",
      dest: "/work/widgets",
      bare: false,
      recurseSubmodules: true,
    });
    await screen.findByText("Cloning widgets");
    expect(commands.repoOpen).not.toHaveBeenCalled();

    act(() => emitOpFinished("op-repoClone"));
    await waitFor(() => expect(commands.repoOpen).toHaveBeenCalledWith("/work/widgets"));
    await waitFor(() => expect(useRepoStore.getState().repos).toHaveLength(1));
  });
});

describe("commands", () => {
  it("registers the new commands without shortcut conflicts", async () => {
    await backend();
    await openRepo();
    const all = Object.values(useCommandStore.getState().commands);
    const ids = all.map((c) => c.id);
    for (const id of [
      "remote.fetch",
      "remote.pull",
      "remote.push",
      "remote.add",
      "repo.clone",
      "staging.stageAll",
      "staging.commit",
      "stash.save",
      "history.undo",
    ]) {
      expect(ids).toContain(id);
    }
    const owners = all.flatMap((c) =>
      (Array.isArray(c.shortcut) ? c.shortcut : c.shortcut ? [c.shortcut] : []).map((s) => ({
        id: c.id,
        shortcut: s,
      })),
    );
    expect(findConflicts(owners, "other")).toEqual([]);
    expect(findConflicts(owners, "mac")).toEqual([]);
  });

  it("previews the undo, then executes it", async () => {
    const commands = await backend();
    commands.undo.mockImplementation((_r: string, dryRun: boolean) =>
      ok(
        dryRun
          ? previewOutcome("Will move main back to abc1234")
          : {
              kind: "applied",
              oplogId: "o",
              head: { kind: "branch", name: "main", oid: oid(0) },
              message: "Undone",
            },
      ),
    );
    const { user } = await openRepo();
    await user.keyboard("{Control>}z{/Control}");
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Will move main back to abc1234")).toBeInTheDocument();
    expect(commands.undo).toHaveBeenCalledTimes(1);
    expect(commands.undo).toHaveBeenCalledWith("r1", true);
    await user.click(within(dialog).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(commands.undo).toHaveBeenCalledTimes(2));
    expect(commands.undo).toHaveBeenLastCalledWith("r1", false);
  });

  it("stages all changes, stashes and focuses the commit box", async () => {
    const commands = await backend();
    commands.status.mockImplementation(() =>
      ok({
        state: "clean",
        staged: [],
        unstaged: [
          {
            path: "a.ts",
            oldPath: null,
            status: "modified",
            additions: 1,
            deletions: 0,
            binary: false,
          },
          {
            path: "b.ts",
            oldPath: null,
            status: "untracked",
            additions: 1,
            deletions: 0,
            binary: false,
          },
        ],
        conflicted: [],
      }),
    );
    const { user } = await openRepo();

    await user.keyboard("{Control>}{Shift>}a{/Shift}{/Control}");
    await waitFor(() => expect(commands.stagePaths).toHaveBeenCalledWith("r1", ["a.ts", "b.ts"]));

    const cmds = useCommandStore.getState().commands;
    const ctx = {
      repoId: "r1",
      queryClient: undefined as never,
      platform: "other" as const,
      openPalette: () => {},
      openShortcutsHelp: () => {},
    };
    act(() => void cmds["stash.save"]!.run(ctx));
    expect(useRepoStore.getState().stashDialog["r1"]).toBe(true);

    act(() => void cmds["staging.commit"]!.run(ctx));
    expect(useRepoStore.getState().selection["r1"]).toEqual({ kind: "wip" });
    await waitFor(() =>
      expect(document.activeElement).toBe(document.getElementById("commit-summary")),
    );
  });
});
