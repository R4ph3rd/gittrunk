import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/app/mockBindings";
import { ANDROID_PLATFORM } from "@/app/platform";
import { installBackend, installDomShims, renderApp, repoInfo, resetStore } from "@/app/testing";
import { useRepoStore } from "@/stores/repo";
import { useHomeDialogs } from "./store";

vi.mock("@/ipc/bindings", async () => {
  const mock = (await import("@/app/mockBindings")).bindingsMock();
  Object.assign(mock.commands, { repoInit: vi.fn() });
  return mock;
});
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/parent")) }));

installDomShims();
Element.prototype.scrollIntoView = vi.fn();

type Fn = ReturnType<typeof vi.fn>;
const backend = async () => {
  const { commands } = await import("@/ipc/bindings");
  return commands as unknown as Record<
    | "repoInit"
    | "repoOpen"
    | "repoForget"
    | "repoKnown"
    | "repoRecent"
    | "settingsGet"
    | "settingsSet"
    | "platformInfo",
    Fn
  >;
};

const known = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    path: `/work/repo${i}`,
    name: `repo${i}`,
    lastOpened: 1_700_000_000 - i,
    exists: true,
  }));

beforeEach(async () => {
  resetStore();
  useHomeDialogs.getState().close();
  vi.clearAllMocks();
  window.localStorage.clear();
  await installBackend();
  const c = await backend();
  c.repoInit.mockImplementation(() => ok({ ...repoInfo, path: "/parent/name", name: "name" }));
});

async function showHome() {
  const user = userEvent.setup();
  renderApp();
  await user.click(await screen.findByRole("button", { name: "Home" }));
  await screen.findByRole("heading", { name: "Home" });
  return user;
}

describe("Home lists", () => {
  it("caps recent at 10 and lists every known repository", async () => {
    const c = await backend();
    c.repoRecent.mockImplementation(() => ok(known(12).map(({ exists: _e, ...r }) => r)));
    c.repoKnown.mockImplementation(() => ok(known(12)));
    await showHome();
    const recent = await screen.findByRole("region", { name: "Recently opened" });
    await waitFor(() => expect(within(recent).getAllByRole("button")).toHaveLength(10));
    const all = screen.getByRole("region", { name: "All repositories" });
    expect(await within(all).findByRole("button", { name: /^repo11/ })).toBeInTheDocument();
    expect(within(all).getByRole("textbox", { name: "Filter repositories" })).toBeInTheDocument();
  });

  it("shows missing repositories as not openable and removes from the list", async () => {
    const c = await backend();
    const list = [
      { path: "/work/demo", name: "demo", lastOpened: 1, exists: true },
      { path: "/work/gone", name: "gone", lastOpened: 2, exists: false },
    ];
    c.repoKnown.mockImplementation(() => ok(list));
    const user = await showHome();
    const all = await screen.findByRole("region", { name: "All repositories" });
    const gone = await within(all).findByRole("button", { name: /^gone/ });
    expect(gone).toBeDisabled();
    expect(within(all).getByText("Missing")).toBeInTheDocument();

    c.repoKnown.mockImplementation(() => ok(list.slice(0, 1)));
    await user.click(within(all).getByRole("button", { name: "Actions for gone" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove from list" }));
    expect(c.repoForget).toHaveBeenCalledWith("/work/gone");
    await waitFor(() => expect(within(all).queryByText("Missing")).toBeNull());
  });

  it("opens a repository from a row", async () => {
    const user = await showHome();
    const recent = await screen.findByRole("region", { name: "Recently opened" });
    await user.click(await within(recent).findByRole("button", { name: /demo/ }));
    expect((await backend()).repoOpen).toHaveBeenCalledWith("/work/demo");
    await screen.findByRole("grid", { name: "Commit graph" });
  });
});

describe("Create repository", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Create repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Create repository" });
    await user.type(within(dialog).getByLabelText("Location"), "/parent");
    await user.type(within(dialog).getByLabelText("Name"), "name");
    return dialog;
  }

  it("inits the repository, opens it and toasts", async () => {
    const user = await showHome();
    const dialog = await fill(user);
    expect(within(dialog).getByTestId("init-path")).toHaveTextContent("/parent/name");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect((await backend()).repoInit).toHaveBeenCalledWith({
      path: "/parent/name",
      bare: false,
      initialBranch: "main",
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Created name"));
    expect(useRepoStore.getState().repos.map((r) => r.path)).toContain("/parent/name");
    expect(screen.queryByRole("dialog", { name: "Create repository" })).toBeNull();
  });

  it("keeps the dialog open with an inline backend error", async () => {
    (await backend()).repoInit.mockImplementation(() => fail("other", "folder already exists"));
    const user = await showHome();
    const dialog = await fill(user);
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("folder already exists");
    expect(screen.getByRole("dialog", { name: "Create repository" })).toBeInTheDocument();
  });

  it("validates the name before calling the backend", async () => {
    const user = await showHome();
    await user.click(await screen.findByRole("button", { name: "Create repository" }));
    const dialog = await screen.findByRole("dialog", { name: "Create repository" });
    await user.type(within(dialog).getByLabelText("Location"), "/parent");
    await user.type(within(dialog).getByLabelText("Name"), "a/b");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect((await backend()).repoInit).not.toHaveBeenCalled();
  });
});

describe("Workspaces", () => {
  it("creates a workspace through settingsSet", async () => {
    const c = await backend();
    const user = await showHome();
    await user.click(await screen.findByRole("button", { name: "New workspace" }));
    const dialog = await screen.findByRole("dialog", { name: "New workspace" });
    await user.type(within(dialog).getByLabelText("Name"), "Team");
    await user.click(await within(dialog).findByRole("checkbox", { name: "demo" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(c.settingsSet).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaces: [{ id: expect.any(String), name: "Team", repos: ["/work/demo"] }],
        }),
      ),
    );
  });

  it("opens all repositories and confirms before deleting", async () => {
    const c = await backend();
    const { settingsGet } = c;
    settingsGet.mockImplementation(() =>
      ok({
        theme: "dark",
        gitPath: null,
        pullStrategy: "merge",
        confirmDestructive: true,
        graphOrder: "topo",
        diffContextLines: 3,
        avatars: "github",
        backdrop: true,
        workspaces: [{ id: "w1", name: "Team", repos: ["/work/a", "/work/b"] }],
      }),
    );
    const user = await showHome();
    const section = await screen.findByRole("region", { name: "Workspaces" });
    expect(within(section).getByText("2 repositories")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Open all" }));
    await waitFor(() => expect(c.repoOpen).toHaveBeenCalledTimes(2));
    expect(c.repoOpen).toHaveBeenNthCalledWith(1, "/work/a");
    expect(c.repoOpen).toHaveBeenNthCalledWith(2, "/work/b");

    await user.click(screen.getByRole("button", { name: "Home" }));
    const again = await screen.findByRole("region", { name: "Workspaces" });
    await user.click(within(again).getByRole("button", { name: "Actions for Team" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(c.settingsSet).not.toHaveBeenCalledWith(expect.objectContaining({ workspaces: [] }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() =>
      expect(c.settingsSet).toHaveBeenCalledWith(expect.objectContaining({ workspaces: [] })),
    );
  });
});

describe("Backdrop and platform", () => {
  it("renders the backdrop only when enabled", async () => {
    const c = await backend();
    await showHome();
    expect(await screen.findByTestId("mesh-backdrop")).toBeInTheDocument();
    const { baseSettings } = await import("@/features/settings/testing");
    c.settingsGet.mockImplementation(() => ok({ ...baseSettings, backdrop: false }));
    const { useSettingsStore } = await import("@/stores/settings");
    await act(() => useSettingsStore.getState().load());
    await waitFor(() => expect(screen.queryByTestId("mesh-backdrop")).toBeNull());
  });

  it("hides Open folder and Create repository on Android", async () => {
    (await backend()).platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
    await showHome();
    expect(await screen.findByRole("button", { name: "Clone" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open folder" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create repository" })).toBeNull();
  });
});
