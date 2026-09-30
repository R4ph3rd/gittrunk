import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "../mockBindings";
import { ANDROID_PLATFORM, DESKTOP_PLATFORM } from "../platform";
import {
  installBackend,
  installDomShims,
  repoInfo,
  renderApp,
  renderAppAt,
  resetStore,
} from "../testing";
import { NO_REPO, useNavStore } from "@/stores/nav";
import { useRepoStore } from "@/stores/repo";
import { setViewport } from "@/test/viewport";

vi.mock("@/ipc/bindings", async () => (await import("../mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));
vi.mock("sonner", async () => (await import("../mockBindings")).sonnerMock());

installDomShims();
Element.prototype.scrollIntoView = vi.fn();

type Mock = ReturnType<typeof vi.fn>;
type Backend = Awaited<ReturnType<typeof installBackend>>;
let backend: Backend;

const other = { ...repoInfo, id: "r2", path: "/work/other", name: "other" };

function mockPlatform(platform: typeof DESKTOP_PLATFORM) {
  (backend.platformInfo as Mock).mockImplementation(() => ok(platform));
}

async function openDemo() {
  const user = userEvent.setup();
  renderAppAt(390, 844);
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("navigation", { name: "Primary" });
  return user;
}

const back = () =>
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

beforeEach(async () => {
  resetStore();
  useNavStore.setState({ byRepo: {} });
  vi.clearAllMocks();
  backend = await installBackend();
});

describe("mobile shell (390x844)", () => {
  it("renders the bottom nav with four tabs and the history fallback, without the desktop panels", async () => {
    await openDemo();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["History", "Changes", "Branches", "More"]);
    expect(await screen.findByRole("grid", { name: "Commit graph" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "References" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Open repositories" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-info")).not.toBeInTheDocument();
  });

  it("switches tabs", async () => {
    const user = await openDemo();
    await user.click(screen.getByRole("button", { name: "Branches" }));
    expect(await screen.findByRole("navigation", { name: "References" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Branches" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("button", { name: /Settings/ })).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
  });

  it("shows a dot on Changes while the working copy is dirty", async () => {
    (backend.status as Mock).mockImplementation(() =>
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
        ],
        conflicted: [],
      }),
    );
    await openDemo();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await waitFor(() =>
      expect(
        within(nav).getByRole("button", { name: "Changes" }).querySelector("span[aria-hidden]"),
      ).not.toBeNull(),
    );
  });

  it("re-tapping the active tab pops to its root", async () => {
    const user = await openDemo();
    act(() => useNavStore.getState().push("r1", { name: "settings" }));
    expect(
      await screen.findByRole("navigation", { name: "Settings sections" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(useNavStore.getState().byRepo["r1"]?.stack).toEqual([]);
    expect(await screen.findByRole("grid", { name: "Commit graph" })).toBeInTheDocument();
  });

  it("pushes the commit route when a commit is tapped in the history fallback", async () => {
    const user = await openDemo();
    await user.click(await screen.findByText("Commit number 2"));
    await waitFor(() =>
      expect(useNavStore.getState().byRepo["r1"]?.stack).toEqual([
        { name: "commit", oid: (2).toString(16).padStart(40, "0") },
      ]),
    );
  });

  it("renders the settings route as a page with Back", async () => {
    const user = await openDemo();
    act(() => useNavStore.getState().push("r1", { name: "settings" }));
    expect(
      await screen.findByRole("navigation", { name: "Settings sections" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Keyboard/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Git/ }));
    expect(await screen.findByRole("region", { name: "Git" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("navigation", { name: "Settings sections" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("grid", { name: "Commit graph" })).toBeInTheDocument();
  });

  it("opens settings as a page when the settings dialog is requested", async () => {
    await openDemo();
    const { useSettingsStore } = await import("@/stores/settings");
    act(() => useSettingsStore.getState().openDialog());
    expect(
      await screen.findByRole("navigation", { name: "Settings sections" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("handles Android back in order: sheet, stack, tab, toast, exit", async () => {
    mockPlatform(ANDROID_PLATFORM);
    const user = await openDemo();
    await waitFor(() => expect(window.history.state).toMatchObject({ gittrunkBack: true }));

    // A sheet on top of the More tab: back closes the sheet first and leaves the tab alone.
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("button", { name: "Repositories" }));
    expect(await screen.findByRole("dialog", { name: "Repositories" })).toBeInTheDocument();

    back();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Repositories" })).toBeNull());
    expect(useNavStore.getState().byRepo["r1"]?.tab).toBe("more");

    act(() => useNavStore.getState().push("r1", { name: "stash" }));

    back();
    expect(useNavStore.getState().byRepo["r1"]?.stack).toEqual([]);
    expect(useNavStore.getState().byRepo["r1"]?.tab).toBe("more");

    back();
    expect(useNavStore.getState().byRepo["r1"]?.tab).toBe("history");

    back();
    expect(toast).toHaveBeenCalledWith("Press back again to exit");
    expect(backend.appExit).not.toHaveBeenCalled();

    back();
    expect(backend.appExit).toHaveBeenCalledTimes(1);
  });

  it("does not install the back button on desktop platforms", async () => {
    const push = vi.spyOn(window.history, "pushState");
    await openDemo();
    await screen.findByRole("grid", { name: "Commit graph" });
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });
});

describe("mobile shell landscape (844x390)", () => {
  it("uses the navigation rail instead of the bottom nav", async () => {
    const user = userEvent.setup();
    renderAppAt(844, 390);
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    const nav = await screen.findByRole("navigation", { name: "Primary" });
    expect(nav).toHaveClass("border-r");
    expect(nav).not.toHaveClass("border-t");
  });
});

describe("regular layout keeps the desktop tree", () => {
  it.each([
    ["1400x900", () => renderAppAt(1400, 900)],
    ["no matchMedia", () => renderApp()],
  ])("renders desktop chrome at %s", async (_name, render) => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    expect(await screen.findByRole("navigation", { name: "References" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Open repositories" })).toBeInTheDocument();
    expect(screen.getByTestId("app-info")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });
});

describe("repo switcher", () => {
  it("lists open repositories and switches the active one", async () => {
    const user = await openDemo();
    act(() => useRepoStore.getState().addRepo(other));
    expect(useRepoStore.getState().activeId).toBe("r2");
    await user.click(await screen.findByRole("button", { name: /other/ }));
    const sheet = await screen.findByRole("dialog", { name: "Repositories" });
    const radios = within(sheet).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    await user.click(within(sheet).getByRole("radio", { name: /demo/ }));
    expect(useRepoStore.getState().activeId).toBe("r1");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Repositories" })).toBeNull());
  });

  it("closes a repository from its row", async () => {
    const user = await openDemo();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    const sheet = await screen.findByRole("dialog", { name: "Repositories" });
    await user.click(within(sheet).getByRole("button", { name: "Close demo" }));
    await waitFor(() => expect(useRepoStore.getState().repos).toEqual([]));
    expect(backend.repoClose).toHaveBeenCalledWith("r1");
  });

  it("offers Open folder only when the platform can pick folders", async () => {
    const user = await openDemo();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    const sheet = await screen.findByRole("dialog", { name: "Repositories" });
    expect(within(sheet).getByRole("button", { name: "Open folder" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Clone repository" })).toBeInTheDocument();
  });

  it("deletes only repositories under the default repos dir, with confirmation", async () => {
    mockPlatform({ ...ANDROID_PLATFORM, defaultReposDir: "/data/repos" });
    (backend.repoRecent as Mock).mockImplementation(() =>
      ok([
        { path: "/data/repos/foo", name: "foo", lastOpened: 2 },
        { path: "/sdcard/demo", name: "demo", lastOpened: 1 },
      ]),
    );
    const user = userEvent.setup();
    renderAppAt(390, 844);
    await screen.findByRole("button", { name: /^foo/ });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Actions for foo" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Actions for demo" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions for foo" }));
    await user.click(await screen.findByRole("button", { name: "Delete repository" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(backend.repoDelete).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(backend.repoDelete).toHaveBeenCalledWith("/data/repos/foo"));
    await waitFor(() => expect((backend.repoRecent as Mock).mock.calls.length).toBeGreaterThan(1));
  });
});

describe("capability gating", () => {
  async function openGitSettings() {
    act(() => useNavStore.getState().push(NO_REPO, { name: "settings", section: "git" }));
    return screen.findByRole("region", { name: "Git" });
  }

  it("hides Open folder and the git path, shows the identity form on Android", async () => {
    mockPlatform(ANDROID_PLATFORM);
    renderAppAt(390, 844);
    expect(await screen.findByRole("button", { name: "Clone repository" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Open folder" })).not.toBeInTheDocument(),
    );
    const region = await openGitSettings();
    expect(await within(region).findByRole("form", { name: "Git identity" })).toBeInTheDocument();
    expect(within(region).getByLabelText("Name")).toHaveValue("Test User");
    expect(within(region).queryByLabelText("Git executable path")).not.toBeInTheDocument();
    expect(within(region).getByRole("radio", { name: "Rebase" })).toBeDisabled();
    expect(within(region).getByText(/Rebase is not available/)).toBeInTheDocument();

    const user = userEvent.setup();
    const name = within(region).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Grace");
    await user.click(within(region).getByRole("button", { name: "Save identity" }));
    await waitFor(() =>
      expect(backend.gitIdentitySet).toHaveBeenCalledWith("Grace", "test@example.com"),
    );
  });

  it("keeps Open folder and the git path field on desktop", async () => {
    renderAppAt(390, 844);
    expect(await screen.findByRole("button", { name: "Open folder" })).toBeInTheDocument();
    const region = await openGitSettings();
    expect(within(region).getByLabelText("Git executable path")).toBeInTheDocument();
    expect(within(region).queryByRole("form", { name: "Git identity" })).not.toBeInTheDocument();
    expect(within(region).getByRole("radio", { name: "Rebase" })).toBeEnabled();
  });

  it("hides Open on a regular-layout Android tablet", async () => {
    mockPlatform(ANDROID_PLATFORM);
    setViewport(1024, 768);
    renderApp();
    expect(await screen.findByRole("button", { name: "Clone repository" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument(),
    );
  });
});
