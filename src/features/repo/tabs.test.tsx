import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBackend, installDomShims, renderApp, resetStore } from "@/app/testing";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));

installDomShims();
Element.prototype.scrollIntoView = vi.fn();

beforeEach(async () => {
  resetStore();
  vi.clearAllMocks();
  window.localStorage.clear();
  await installBackend();
});

async function openRepo() {
  const user = userEvent.setup();
  renderApp();
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("grid", { name: "Commit graph" });
  return user;
}

const ctrl = (key: string) => `{Control>}${key}{/Control}`;

describe("new tab", () => {
  it("opens a start view with + without the folder picker", async () => {
    const user = await openRepo();
    await user.click(screen.getByRole("button", { name: "New tab" }));
    expect(screen.getByRole("tab", { name: "New tab" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Open a repository" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open repository" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clone repository" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create repository" })).toBeInTheDocument();
    const recent = await screen.findByRole("region", { name: "Recent repositories" });
    expect(within(recent).getByRole("button", { name: /demo/ })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("replaces the placeholder when a recent repository is opened", async () => {
    const user = userEvent.setup();
    const { commands } = await import("@/ipc/bindings");
    renderApp();
    await user.click(await screen.findByRole("button", { name: "New tab" }));
    const recent = await screen.findByRole("region", { name: "Recent repositories" });
    await user.click(within(recent).getByRole("button", { name: /demo/ }));
    await screen.findByRole("grid", { name: "Commit graph" });
    expect(commands.repoOpen).toHaveBeenCalledWith("/work/demo");
    expect(screen.queryByRole("tab", { name: "New tab" })).toBeNull();
  });

  it("closes a placeholder with its X, and with mod+w", async () => {
    const user = await openRepo();
    await user.click(screen.getByRole("button", { name: "New tab" }));
    await user.click(screen.getByRole("button", { name: "Close New tab" }));
    expect(screen.queryByRole("tab", { name: "New tab" })).toBeNull();
    await user.keyboard(ctrl("t"));
    expect(await screen.findByRole("tab", { name: "New tab" })).toBeInTheDocument();
    await user.keyboard(ctrl("w"));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "New tab" })).toBeNull());
    // The repository tab survives: mod+w only closed the placeholder.
    expect(screen.getByRole("tab", { name: "demo" })).toBeInTheDocument();
  });
});

describe("home and tab switching", () => {
  it("shows Home from the wordmark and keeps the repository mounted", async () => {
    const user = await openRepo();
    const { commands } = await import("@/ipc/bindings");
    const graphLoad = commands.graphLoad as ReturnType<typeof vi.fn>;
    const loads = graphLoad.mock.calls.length;
    const home = screen.getByRole("button", { name: "Home" });
    await user.click(home);
    expect(home).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "demo" })).toHaveAttribute("aria-selected", "false");
    await user.click(screen.getByRole("tab", { name: "demo" }));
    expect(home).not.toHaveAttribute("aria-current");
    expect(await screen.findByRole("grid", { name: "Commit graph" })).toBeVisible();
    expect(graphLoad.mock.calls.length).toBe(loads);
  });
});

describe("right cluster", () => {
  it("opens settings and shows layout toggles only on a repository", async () => {
    const user = await openRepo();
    const toggles = () => screen.queryByRole("group", { name: "Layout" });
    expect(toggles()).toBeInTheDocument();
    const cluster = screen.getByRole("group", { name: "Application" });
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("separator")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(toggles()).toBeNull();
    expect(within(header).queryByRole("separator")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "demo" }));
    await user.click(screen.getByRole("button", { name: "New tab" }));
    expect(toggles()).toBeNull();

    await user.click(within(cluster).getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("dialog", { name: /settings/i })).toBeInTheDocument();
  });
});
