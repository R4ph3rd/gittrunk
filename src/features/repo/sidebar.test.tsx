import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANDROID_PLATFORM } from "@/app/platform";
import { installBackend, installDomShims, oid, ok, renderApp, resetStore } from "@/app/testing";
import { useDndStore } from "@/stores/dnd";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("/work")),
}));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();

describe("RefsSidebar", () => {
  beforeEach(() => {
    resetStore();
    useDndStore.getState().setPrompt(null);
    vi.clearAllMocks();
  });

  it("shows the Local section", async () => {
    await installBackend();
    renderApp();

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(await screen.findByRole("button", { name: /demo/ }));

    const localSection = await screen.findByText("Local");
    expect(localSection).toBeInTheDocument();
  });

  it("has a + button to create a branch", async () => {
    await installBackend();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp();

    await user.click(await screen.findByRole("button", { name: /demo/ }));
    await screen.findByRole("toolbar", { name: "Remote operations" });

    const createBtn = await screen.findByLabelText("Create branch");
    expect(createBtn).toBeInTheDocument();
  });

  it("clicking the + button opens the branch prompt", async () => {
    await installBackend();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp();

    await user.click(await screen.findByRole("button", { name: /demo/ }));
    await screen.findByRole("toolbar", { name: "Remote operations" });

    const createBtn = await screen.findByLabelText("Create branch");
    await user.click(createBtn);

    const prompt = useDndStore.getState().prompt;
    expect(prompt).not.toBeNull();
    expect(prompt?.kind).toBe("branch");
  });

  it("colors branch and tag icons like their lane, others stay neutral", async () => {
    const commands = await installBackend();
    commands.graphLoad.mockImplementation(() =>
      ok({
        rowCount: 1000,
        laneCount: 3,
        headRow: 0,
        refColors: [{ fullName: "refs/heads/main", color: 2 }],
      }),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    const nav = await screen.findByRole("navigation", { name: "References" });
    const icon = (label: string) =>
      within(nav).getByRole("button", { name: label }).querySelector("svg");
    await waitFor(() => expect(icon("main")).toHaveStyle({ color: "var(--lane-2)" }));
    expect(icon("v1.0")).toHaveStyle({ color: "var(--fg-subtle)" });
  });
});

describe("RefsSidebar on a read-only platform", () => {
  beforeEach(() => {
    resetStore();
    useDndStore.getState().setPrompt(null);
    vi.clearAllMocks();
  });

  it("hides branch creation, push, remote edits and stash actions", async () => {
    const commands = await installBackend();
    commands.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
    const original = commands.refsList.getMockImplementation() as (
      ...a: unknown[]
    ) => Promise<{ status: "ok"; data: Record<string, unknown> }>;
    commands.refsList.mockImplementation(async (...args: unknown[]) => {
      const res = await original(...args);
      return ok({
        ...res.data,
        stashes: [{ index: 0, oid: oid(9), message: "wip on main", branch: "main", time: 1 }],
      });
    });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    const nav = await screen.findByRole("navigation", { name: "References" });
    await within(nav).findByText("wip on main");

    expect(within(nav).queryByLabelText("Create branch")).toBeNull();
    expect(within(nav).queryByRole("button", { name: "Add remote" })).toBeNull();

    fireEvent.contextMenu(within(nav).getByRole("button", { name: "main" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Push" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: /Set upstream/ })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.contextMenu(within(nav).getByRole("button", { name: "Remote origin" }));
    const remoteMenu = await screen.findByRole("menu");
    expect(within(remoteMenu).getByRole("menuitem", { name: "Fetch" })).toBeInTheDocument();
    for (const name of ["Edit URL", "Rename", "Remove"]) {
      expect(within(remoteMenu).queryByRole("menuitem", { name })).toBeNull();
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.contextMenu(within(nav).getByText("wip on main"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(commands.stashApply).not.toHaveBeenCalled();
  });
});
