import { useDraggable } from "@dnd-kit/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/app/mockBindings";
import { ANDROID_PLATFORM, DESKTOP_PLATFORM } from "@/app/platform";
import {
  installBackend,
  installDomShims,
  makeStatus,
  oid,
  renderApp,
  renderAppAt,
  resetStore,
} from "@/app/testing";
import { buildActionEntries, type ActionContext } from "@/features/operations/actions/entries";
import { entriesToSheetGroups } from "@/features/operations/actions/sheetGroups";
import { OperationsProvider } from "@/features/operations/dnd/OperationsProvider";
import { useDndNode } from "@/features/operations/dnd/useDndNode";
import { TooltipProvider } from "@/design/components";
import { useDndStore } from "@/stores/dnd";
import { useNavStore } from "@/stores/nav";
import { useRemotesUi } from "@/stores/remotes";
import { setViewport } from "@/test/viewport";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work")) }));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();
Element.prototype.scrollIntoView = vi.fn();

type Mock = ReturnType<typeof vi.fn>;
type Backend = Awaited<ReturnType<typeof installBackend>>;
let backend: Backend;

function mockPlatform(platform: typeof DESKTOP_PLATFORM) {
  (backend.platformInfo as Mock).mockImplementation(() => ok(platform));
}

async function openDemo(width = 390, height = 844) {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderAppAt(width, height);
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  return user;
}

const row = (i: number) => document.getElementById(`graph-row-${i}`) as HTMLElement;

beforeEach(async () => {
  resetStore();
  useNavStore.setState({ byRepo: {} });
  useDndStore.setState({ menu: null, confirm: null, prompt: null, drag: null, cursor: -1 });
  vi.clearAllMocks();
  backend = await installBackend();
});

describe("History screen (390x844)", () => {
  it("renders two-line rows with author, time, short hash and ref chips", async () => {
    await openDemo();
    await screen.findByText("Commit number 0");
    const first = row(0);
    expect(first).toHaveAttribute("data-compact");
    expect(first).toHaveStyle({ height: "56px" });
    expect(within(first).getByText("Commit number 0")).toBeInTheDocument();
    expect(within(first).getByText("Ada")).toBeInTheDocument();
    expect(within(first).getByText(oid(0).slice(0, 7))).toHaveClass("font-mono");
    expect(within(first).getByText("main")).toHaveAttribute("data-kind", "localBranch");
    expect(within(first).getByRole("button", { name: /^Actions for/ })).toBeInTheDocument();
  });

  it("pushes the commit route when a row is tapped", async () => {
    const user = await openDemo();
    await user.click(await screen.findByText("Commit number 2"));
    await waitFor(() =>
      expect(useNavStore.getState().byRepo["r1"]?.stack).toEqual([{ name: "commit", oid: oid(2) }]),
    );
    expect(await screen.findByText("Details for 2")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Changed files" })).toBeInTheDocument();
  });

  it("opens the same entries as the desktop registry on long-press", async () => {
    await openDemo();
    await screen.findByText("Commit number 1");
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(row(1), { clientX: 5, clientY: 5, pointerId: 1 });
      act(() => void vi.advanceTimersByTime(450));
    } finally {
      vi.useRealTimers();
    }
    const sheet = await screen.findByRole("dialog", { name: oid(1).slice(0, 7) });
    const ctx: ActionContext = {
      repoId: "r1",
      head: { kind: "branch", name: "main", oid: oid(0) },
      perform: vi.fn(),
      prompt: vi.fn(),
      copy: vi.fn(),
      openRebaseEditor: vi.fn(),
      platform: DESKTOP_PLATFORM,
    };
    const entries = buildActionEntries(
      { kind: "commit", oid: oid(1), shortOid: oid(1).slice(0, 7) },
      ctx,
    );
    const items = entries.filter((e) => e.kind === "item");
    const groups = entriesToSheetGroups(entries);
    expect(groups.flat().map((i) => i.id)).toEqual(items.map((e) => e.id));
    const labels = within(sheet)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t !== "Cancel");
    expect(labels).toEqual(items.map((e) => e.label));
    expect(useNavStore.getState().byRepo["r1"]?.stack ?? []).toEqual([]);
  });

  it("fetches on pull-to-refresh", async () => {
    await openDemo();
    await screen.findByText("Commit number 0");
    const wrapper = screen.getAllByRole("status")[0]?.parentElement as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(wrapper, { clientY: 0, pointerId: 1 });
      fireEvent.pointerMove(wrapper, { clientY: 200, pointerId: 1 });
      fireEvent.pointerUp(wrapper, { clientY: 200, pointerId: 1 });
    });
    await waitFor(() =>
      expect(backend.fetch).toHaveBeenCalledWith("r1", { remote: null, prune: true, tags: false }),
    );
  });

  it("switches to the Changes tab from the WIP row", async () => {
    (backend.status as Mock).mockImplementation(() =>
      ok(
        makeStatus({
          unstaged: [
            {
              path: "a.ts",
              oldPath: null,
              status: "modified",
              additions: 1,
              deletions: 0,
              binary: false,
            },
          ],
        }),
      ),
    );
    const user = await openDemo();
    await user.click(await screen.findByTestId("wip-row"));
    expect(useNavStore.getState().byRepo["r1"]?.tab).toBe("changes");
  });
});

describe("Branches screen (390x844)", () => {
  it("switches between Local, Remotes and Tags", async () => {
    const user = await openDemo();
    await user.click(await screen.findByRole("button", { name: "Branches" }));
    expect(await screen.findByRole("list", { name: "Local branches" })).toBeInTheDocument();
    const dot = screen.getByTestId("current-branch-dot");
    expect(dot).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Remotes" }));
    expect(await screen.findByRole("button", { name: "Add remote" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Local branches" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Tags" }));
    expect(await screen.findByText("v1.0")).toBeInTheDocument();
  });

  it("opens the ref action sheet on tap with the registry entries", async () => {
    const user = await openDemo();
    await user.click(await screen.findByRole("button", { name: "Branches" }));
    await user.click(await screen.findByRole("button", { name: "Actions for main" }));
    const sheet = await screen.findByRole("dialog", { name: "main" });
    expect(within(sheet).getByRole("button", { name: "Create branch here…" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Push" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Show reflog" })).toBeInTheDocument();
  });
});

describe("drag and drop", () => {
  function Probe() {
    // Without sensors dnd-kit hands out no activator listeners.
    const raw = useDraggable({ id: "raw" });
    const node = useDndNode({
      id: "x",
      repoId: "r1",
      source: { kind: "tag", name: "t", fullName: "refs/tags/t", oid: oid(1) },
      keyboard: true,
    });
    return (
      <div
        data-testid="probe"
        data-listeners={Object.keys(raw.listeners ?? {}).length > 0 ? "yes" : "no"}
        {...node.dragProps}
      >
        x
      </div>
    );
  }
  const mount = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <OperationsProvider>
            <Probe />
          </OperationsProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    );

  it("registers no sensors and inert props on compact layouts", () => {
    setViewport(390, 844);
    mount();
    expect(screen.getByTestId("probe")).toHaveAttribute("data-listeners", "no");
    expect(screen.getByTestId("probe")).not.toHaveAttribute("aria-roledescription");
  });

  it("keeps the sensors on regular layouts", () => {
    setViewport(1400, 900);
    mount();
    expect(screen.getByTestId("probe")).toHaveAttribute("data-listeners", "yes");
    expect(screen.getByTestId("probe")).toHaveAttribute("aria-roledescription", "draggable");
  });
});

describe("platform capabilities", () => {
  const ctx = (platform: ActionContext["platform"]): ActionContext => ({
    repoId: "r1",
    head: { kind: "branch", name: "main", oid: oid(0) },
    perform: vi.fn(),
    prompt: vi.fn(),
    copy: vi.fn(),
    openRebaseEditor: vi.fn(),
    platform,
  });
  const ids = (platform: ActionContext["platform"]) =>
    buildActionEntries({ kind: "commit", oid: oid(1), shortOid: "abc" }, ctx(platform))
      .filter((e) => e.kind === "item")
      .map((e) => e.id);

  it("hides rebase entries without git CLI rebase support, on any layout", () => {
    expect(ids(DESKTOP_PLATFORM)).toEqual(expect.arrayContaining(["rebase", "interactiveRebase"]));
    const android = ids(ANDROID_PLATFORM);
    expect(android).not.toContain("rebase");
    expect(android).not.toContain("interactiveRebase");
    expect(android).toContain("merge");
    expect(android).toContain("cherryPick");
    const branch = buildActionEntries(
      {
        kind: "branch",
        name: "dev",
        fullName: "refs/heads/dev",
        remote: false,
        isHead: false,
        oid: oid(2),
      },
      ctx(ANDROID_PLATFORM),
    );
    expect(branch.some((e) => e.kind === "item" && e.id === "rebase")).toBe(false);
    // Android tablets use the regular layout but keep the capability limits.
    const last = branch[branch.length - 1];
    expect(last?.kind).toBe("item");
  });

  it("hides worktree sections when worktrees are unsupported", async () => {
    (backend.worktreeList as Mock).mockImplementation(() =>
      ok([
        {
          path: "/work/demo",
          branch: "main",
          head: oid(0),
          isMain: true,
          locked: false,
          prunable: false,
        },
      ]),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    expect(await screen.findByRole("button", { name: /^Worktrees/ })).toBeInTheDocument();
  });

  it("drops the worktree section on an Android platform", async () => {
    mockPlatform(ANDROID_PLATFORM);
    (backend.worktreeList as Mock).mockImplementation(() =>
      ok([
        {
          path: "/work/demo",
          branch: "main",
          head: oid(0),
          isMain: true,
          locked: false,
          prunable: false,
        },
      ]),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setViewport(1400, 900);
    renderApp();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    await screen.findByRole("navigation", { name: "References" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Worktrees/ })).not.toBeInTheDocument(),
    );
  });
});

describe("clone", () => {
  async function openClone(platform: typeof DESKTOP_PLATFORM) {
    mockPlatform(platform);
    (backend.credentialStore as Mock).mockImplementation(() => ok(null));
    renderAppAt(390, 844);
    await screen.findByRole("button", { name: "Clone repository" });
    // Let the capability query settle before the dialog reads it.
    await waitFor(() => expect(backend.platformInfo).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    act(() => useRemotesUi.getState().setCloneOpen(true));
    return screen.findByRole("dialog", { name: "Clone repository" });
  }

  it("clones into app storage with a token, storing it first", async () => {
    const dialog = await openClone({ ...ANDROID_PLATFORM, defaultReposDir: "/data/repos" });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.type(
      within(dialog).getByLabelText("Repository URL"),
      "https://github.com/acme/widgets.git",
    );
    expect(within(dialog).getByTestId("clone-dest")).toHaveTextContent("/data/repos/widgets");
    expect(within(dialog).queryByRole("button", { name: "Browse" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Username (optional)"), "ada");
    await user.type(within(dialog).getByLabelText("Personal access token (optional)"), "ghp_x");
    await user.click(within(dialog).getByRole("button", { name: "Clone" }));
    await waitFor(() => expect(backend.repoClone).toHaveBeenCalled());
    expect(backend.credentialStore).toHaveBeenCalledWith({
      host: "github.com",
      username: "ada",
      secret: "ghp_x",
    });
    expect((backend.credentialStore as Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (backend.repoClone as Mock).mock.invocationCallOrder[0] ?? 0,
    );
    expect(backend.repoClone).toHaveBeenCalledWith({
      url: "https://github.com/acme/widgets.git",
      dest: "/data/repos/widgets",
      bare: false,
      recurseSubmodules: false,
    });
  });

  it("rejects ssh URLs when SSH is unsupported", async () => {
    const dialog = await openClone({ ...ANDROID_PLATFORM, defaultReposDir: "/data/repos" });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.type(
      within(dialog).getByLabelText("Repository URL"),
      "ssh://git@github.com/a/b.git",
    );
    await user.click(within(dialog).getByRole("button", { name: "Clone" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Use an HTTPS URL and a personal access token",
    );
    expect(backend.repoClone).not.toHaveBeenCalled();
  });

  it("keeps the folder picker and no token fields on desktop", async () => {
    const dialog = await openClone(DESKTOP_PLATFORM);
    expect(within(dialog).getByRole("button", { name: "Browse" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Personal access token/)).not.toBeInTheDocument();
  });
});
