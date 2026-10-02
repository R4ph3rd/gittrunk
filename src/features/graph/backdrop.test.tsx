import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBackend, installDomShims, renderApp, resetStore } from "@/app/testing";
import { baseSettings } from "@/features/settings/testing";
import { resetAvatarImages } from "./avatarImages";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();

let commands: Awaited<ReturnType<typeof installBackend>>;

beforeEach(async () => {
  vi.clearAllMocks();
  resetStore();
  resetAvatarImages();
  commands = await installBackend(20);
});

async function openGraph() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderApp();
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  const grid = await screen.findByRole("grid", { name: "Commit graph" });
  await screen.findByText("Commit number 2");
  return { user, grid };
}

describe("graph backdrop", () => {
  it("mounts a subtle backdrop behind the rows, and rows stay clickable", async () => {
    const { user, grid } = await openGraph();
    const backdrop = await screen.findByTestId("mesh-backdrop");
    expect(backdrop).toHaveAttribute("data-intensity", "subtle");
    expect(backdrop.parentElement).toContainElement(grid);
    expect(backdrop.parentElement?.firstElementChild).toBe(backdrop);
    await user.click(screen.getByText("Commit number 2"));
    expect(await screen.findAllByText("Details for 2")).not.toHaveLength(0);
  });

  it("is absent when the backdrop setting is off", async () => {
    (
      commands.settingsGet as unknown as { mockImplementation: (f: unknown) => void }
    ).mockImplementation(() =>
      Promise.resolve({ status: "ok", data: { ...baseSettings, backdrop: false } }),
    );
    await openGraph();
    expect(screen.queryByTestId("mesh-backdrop")).toBeNull();
  });
});
