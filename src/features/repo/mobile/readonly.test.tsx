import { useDraggable } from "@dnd-kit/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/app/mockBindings";
import { ANDROID_PLATFORM, DESKTOP_PLATFORM } from "@/app/platform";
import { installBackend, installDomShims, oid, renderAppAt, resetStore } from "@/app/testing";
import { TooltipProvider } from "@/design/components";
import { buildActionEntries, type ActionContext } from "@/features/operations/actions/entries";
import { OperationsProvider } from "@/features/operations/dnd/OperationsProvider";
import { queryKeys } from "@/ipc/queries";
import { useDndStore } from "@/stores/dnd";
import { useNavStore } from "@/stores/nav";
import { setViewport } from "@/test/viewport";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work")) }));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());
vi.mock("@/features/forge/mobile/contrib", () => ({
  forgeScreens: {
    tabs: { issues: () => <div data-testid="issues-marker">issues screen</div> },
  },
}));
vi.mock("@/features/forge/CommitComments", () => ({
  CommitComments: ({ oid }: { oid: string }) => <div data-testid="comments-marker">{oid}</div>,
}));

installDomShims();
Element.prototype.scrollIntoView = vi.fn();

type Mock = ReturnType<typeof vi.fn>;
type Backend = Awaited<ReturnType<typeof installBackend>>;
let backend: Backend;

const useAndroid = () =>
  (backend.platformInfo as Mock).mockImplementation(() => ok(ANDROID_PLATFORM));

async function openDemo(width = 390, height = 844) {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderAppAt(width, height);
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("navigation", { name: "Primary" });
  return user;
}

const navLabels = () =>
  within(screen.getByRole("navigation", { name: "Primary" }))
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

const sheetLabels = (sheet: HTMLElement) =>
  within(sheet)
    .getAllByRole("button")
    .map((b) => b.textContent)
    .filter((t) => t !== "Cancel");

beforeEach(async () => {
  resetStore();
  useNavStore.setState({ byRepo: {} });
  useDndStore.setState({ menu: null, confirm: null, prompt: null, drag: null, cursor: -1 });
  vi.clearAllMocks();
  backend = await installBackend();
});

describe("read-only navigation", () => {
  it("shows History, Branches, Issues, More and the contributed Issues screen", async () => {
    useAndroid();
    const user = await openDemo();
    await waitFor(() => expect(navLabels()).toEqual(["History", "Branches", "Issues", "More"]));
    await user.click(screen.getByRole("button", { name: "Issues" }));
    expect(await screen.findByTestId("issues-marker")).toBeInTheDocument();
  });

  it("shows History when the stored tab is Changes", async () => {
    useAndroid();
    useNavStore.getState().setTab("r1", "changes");
    await openDemo();
    expect(await screen.findByRole("grid", { name: "Commit graph" })).toBeInTheDocument();
  });

  it("renders NotAvailable for write routes", async () => {
    useAndroid();
    await openDemo();
    await waitFor(() => expect(navLabels()).toHaveLength(4));
    act(() => useNavStore.getState().push("r1", { name: "compose" }));
    expect(await screen.findByText(/not available on this device/i)).toBeInTheDocument();
  });

  it("keeps Changes and adds Issues on desktop platforms", async () => {
    await openDemo();
    expect(navLabels()).toEqual(["History", "Changes", "Branches", "Issues", "More"]);
  });
});

describe("read-only History and commit page", () => {
  it("offers Fetch and Pull only, and Pull is fast-forward only", async () => {
    useAndroid();
    (backend.refsList as Mock).mockImplementation(() =>
      ok({
        head: { kind: "branch", name: "main", oid: oid(0) },
        local: [
          {
            name: "main",
            fullName: "refs/heads/main",
            oid: oid(0),
            upstream: "origin/main",
            ahead: 0,
            behind: 1,
            isHead: true,
            remote: null,
          },
        ],
        remote: [],
        tags: [],
        stashes: [],
      }),
    );
    const user = await openDemo();
    await user.click(await screen.findByRole("button", { name: "Remote actions" }));
    const sheet = await screen.findByRole("dialog", { name: "Remote" });
    expect(sheetLabels(sheet)).toEqual(["Fetch", "Pull"]);
    await user.click(within(sheet).getByRole("button", { name: "Pull" }));
    await waitFor(() =>
      expect(backend.pull).toHaveBeenCalledWith("r1", {
        remote: "origin",
        branch: "main",
        strategy: "ffOnly",
      }),
    );
  });

  it("opens only checkout and copy entries on a commit sheet and shows comments", async () => {
    useAndroid();
    const user = await openDemo();
    await user.click(await screen.findByText("Commit number 1"));
    expect(await screen.findByTestId("comments-marker")).toHaveTextContent(oid(1));
    await user.click(screen.getByRole("button", { name: "Commit actions" }));
    const sheet = await screen.findByRole("dialog", { name: oid(1).slice(0, 7) });
    expect(sheetLabels(sheet)).toEqual(["Checkout commit", "Copy SHA"]);
  });
});

describe("read-only Branches", () => {
  it("has no New branch, Add remote or remote edit actions and filters the ref sheet", async () => {
    useAndroid();
    const user = await openDemo();
    await user.click(await screen.findByRole("button", { name: "Branches" }));
    await screen.findByRole("list", { name: "Local branches" });
    expect(screen.queryByRole("button", { name: "New branch" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fetch" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions for main" }));
    const sheet = await screen.findByRole("dialog", { name: "main" });
    const labels = sheetLabels(sheet);
    expect(labels).toContain("Copy branch name");
    expect(labels).toContain("Show reflog");
    for (const hidden of ["Push", "Set upstream…", "Create branch here…", "Delete branch"]) {
      expect(labels).not.toContain(hidden);
    }
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("radio", { name: "Remotes" }));
    expect(screen.queryByRole("button", { name: "Add remote" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Actions for remote origin" }));
    const remote = await screen.findByRole("dialog", { name: "origin" });
    expect(sheetLabels(remote)).toEqual(["Fetch", "Copy URL"]);
  });
});

describe("read-only More", () => {
  it("hides Stash, Ask AI and Actions", async () => {
    useAndroid();
    const user = await openDemo();
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByText("Reflog")).toBeInTheDocument();
    expect(screen.getByText("Repositories")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Stash")).not.toBeInTheDocument();
    expect(screen.queryByText("Ask AI")).not.toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });
});

describe("entries and drag and drop", () => {
  const ctx = (platform: ActionContext["platform"]): ActionContext => ({
    repoId: "r1",
    head: { kind: "branch", name: "main", oid: oid(0) },
    perform: vi.fn(),
    prompt: vi.fn(),
    copy: vi.fn(),
    openRebaseEditor: vi.fn(),
    platform,
  });
  const branch = {
    kind: "branch",
    name: "dev",
    fullName: "refs/heads/dev",
    remote: false,
    isHead: false,
    oid: oid(2),
  } as const;
  const commit = { kind: "commit", oid: oid(1), shortOid: "abc" } as const;
  const tag = { kind: "tag", name: "v1", oid: oid(3) } as const;
  const idsOf = (entries: ReturnType<typeof buildActionEntries>) =>
    entries.filter((e) => e.kind === "item").map((e) => e.id);

  it("keeps checkout and copy entries only when read-only (regular layout too)", () => {
    setViewport(1400, 900);
    const c = ctx(ANDROID_PLATFORM);
    expect(idsOf(buildActionEntries(commit, c))).toEqual(["checkout", "copySha"]);
    expect(idsOf(buildActionEntries(branch, c))).toEqual(["checkout", "copyName"]);
    expect(idsOf(buildActionEntries({ ...branch, remote: true }, c))).toEqual([
      "checkout",
      "copyName",
    ]);
    expect(idsOf(buildActionEntries(tag, c))).toEqual(["checkout", "copyName"]);
  });

  it("leaves desktop entries unchanged", () => {
    const c = ctx(DESKTOP_PLATFORM);
    expect(idsOf(buildActionEntries(commit, c))).toEqual([
      "checkout",
      "createBranch",
      "createTag",
      "merge",
      "rebase",
      "cherryPick",
      "revert",
      "reset.soft",
      "reset.mixed",
      "reset.hard",
      "interactiveRebase",
      "copySha",
    ]);
    expect(idsOf(buildActionEntries(branch, c))).toEqual([
      "checkout",
      "createBranch",
      "merge",
      "rebase",
      "rename",
      "delete",
      "copyName",
    ]);
    expect(idsOf(buildActionEntries(tag, c))).toEqual([
      "checkout",
      "createBranch",
      "deleteTag",
      "copyName",
    ]);
  });

  function Probe() {
    // Without sensors dnd-kit hands out no activator listeners.
    const raw = useDraggable({ id: "raw" });
    return (
      <div
        data-testid="probe"
        data-listeners={Object.keys(raw.listeners ?? {}).length > 0 ? "yes" : "no"}
      >
        x
      </div>
    );
  }

  it("registers no drag sensors on a read-only regular layout", () => {
    setViewport(1400, 900);
    const client = new QueryClient();
    client.setQueryData(queryKeys.platformInfo, ANDROID_PLATFORM);
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <OperationsProvider>
            <Probe />
          </OperationsProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveAttribute("data-listeners", "no");
  });
});
