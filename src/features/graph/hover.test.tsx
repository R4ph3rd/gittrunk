import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBackend, installDomShims, oid, renderApp, resetStore } from "@/app/testing";
import { resetAvatarImages } from "./avatarImages";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();

const writeText = vi.fn(() => Promise.resolve());

beforeEach(async () => {
  vi.clearAllMocks();
  resetStore();
  resetAvatarImages();
  await installBackend(20);
});

afterEach(() => {
  vi.useRealTimers();
});

async function openGraph() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderApp();
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  const grid = await screen.findByRole("grid", { name: "Commit graph" });
  await screen.findByText("Commit number 2");
  return { user, grid };
}

const rowEl = (grid: HTMLElement, i: number) =>
  grid.querySelector(`[data-index="${i}"]`) as HTMLElement;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("commit hover card", () => {
  it("opens after 500 ms of hover with date, oids and the full message, and closes on leave", async () => {
    const { grid } = await openGraph();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.pointerEnter(rowEl(grid, 2), { pointerType: "mouse" });
    await advance(300);
    expect(screen.queryByLabelText("Commit summary")).toBeNull();
    await advance(300);
    const card = await screen.findByLabelText("Commit summary");
    expect(within(card).getByText(oid(2).slice(0, 7))).toBeInTheDocument();
    expect(within(card).getByText(oid(2))).toBeInTheDocument();
    expect(within(card).getByText("ada@example.com")).toBeInTheDocument();
    expect(card.textContent).toMatch(/\(\d+[a-z]+ ago\)/);
    await advance(10);
    expect(card.textContent).toContain("Details for 2");
    expect(card.textContent).toContain("Body text");

    fireEvent.click(within(card).getByRole("button", { name: "Copy full commit id" }));
    expect(writeText).toHaveBeenCalledWith(oid(2));
    fireEvent.click(within(card).getByRole("button", { name: "Copy short commit id" }));
    expect(writeText).toHaveBeenCalledWith(oid(2).slice(0, 7));

    fireEvent.pointerLeave(rowEl(grid, 2), { pointerType: "mouse" });
    await advance(400);
    expect(screen.queryByLabelText("Commit summary")).toBeNull();
  });

  it("Alt+Enter opens the card for the selected row and Escape closes it", async () => {
    const { grid } = await openGraph();
    fireEvent.click(rowEl(grid, 3));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    grid.focus();
    fireEvent.keyDown(grid, { key: "Enter", altKey: true });
    const card = await screen.findByLabelText("Commit summary");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(card.textContent).toContain(oid(3));
    fireEvent.keyDown(grid, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Commit summary")).toBeNull());
  });
});
