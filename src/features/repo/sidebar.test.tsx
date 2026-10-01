import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBackend, installDomShims, renderApp, resetStore } from "@/app/testing";
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
});
