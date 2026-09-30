import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitRepoChanged, fail } from "./mockBindings";
import { installBackend, installDomShims, oid, renderApp, resetStore } from "./testing";

vi.mock("@/ipc/bindings", async () => (await import("./mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));

installDomShims();

async function openRepo() {
  const user = userEvent.setup();
  renderApp();
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("grid", { name: "Commit graph" });
  await screen.findByText("Commit number 0");
  return user;
}

beforeEach(async () => {
  resetStore();
  vi.clearAllMocks();
  await installBackend();
});

describe("App shell", () => {
  it("renders backend info through the typed contract", async () => {
    renderApp();
    expect(
      await screen.findByText(/v0\.1\.0 · windows · git version 2\.45\.0/),
    ).toBeInTheDocument();
  });

  it("shows the welcome screen with recent repositories when nothing is open", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { name: "Open a repository" })).toBeInTheDocument();
    expect(await screen.findByText("/work/demo")).toBeInTheDocument();
  });

  it("shows repoOpen errors inline", async () => {
    const { commands } = await import("@/ipc/bindings");
    (commands.repoOpen as ReturnType<typeof vi.fn>).mockImplementation(() =>
      fail("notARepo", "not a git repository"),
    );
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not a git repository");
  });
});

describe("graph view", () => {
  it("opens a repository and shows the graph, sidebar and status bar", async () => {
    await openRepo();
    expect(screen.getByText("main", { selector: "[data-head]" })).toBeInTheDocument();
    expect(await screen.findByRole("navigation", { name: "References" })).toHaveTextContent("v1.0");
    expect(await screen.findByTestId("repo-status")).toBeInTheDocument();
    expect(screen.getByTestId("app-info")).toHaveTextContent("v0.1.0");
  });

  it("loads commit details when a row is selected", async () => {
    const user = await openRepo();
    await user.click(screen.getByText("Commit number 2"));
    const details = await screen.findByRole("complementary", { name: "Commit details" });
    expect(await within(details).findByText("Details for 2")).toBeInTheDocument();
    expect(within(details).getByText("+3")).toBeInTheDocument();

    await user.click(within(details).getByText("src/lib.rs"));
    expect(await screen.findByText("new line")).toBeInTheDocument();

    // parent link selects that commit
    await user.click(within(details).getByRole("button", { name: oid(3).slice(0, 7) }));
    expect(await within(details).findByText("Details for 3")).toBeInTheDocument();
  });

  it("supports keyboard navigation", async () => {
    const user = await openRepo();
    const grid = screen.getByRole("grid", { name: "Commit graph" });
    grid.focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(screen.getAllByRole("row").find((r) => r.dataset.index === "0")).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByText("Details for 1")).toBeInTheDocument();
    await user.keyboard("{End}");
    expect(await screen.findByText("Details for 999")).toBeInTheDocument();
    await user.keyboard("{Home}");
    expect(await screen.findByText("Details for 0")).toBeInTheDocument();
  });

  it("focuses search with / and jumps between matches", async () => {
    const { commands } = await import("@/ipc/bindings");
    (commands.graphSearch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ status: "ok", data: [5, 42] }),
    );
    const user = await openRepo();
    screen.getByRole("grid", { name: "Commit graph" }).focus();
    await user.keyboard("/");
    const input = screen.getByRole("searchbox", { name: "Search commits" });
    expect(input).toHaveFocus();
    await user.keyboard("fix"); // focus is already in the input (a click would hit the panel separator hit-test in jsdom)
    await waitFor(() => expect(screen.getByTestId("search-count")).toHaveTextContent("0 / 2"));
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Details for 5")).toBeInTheDocument();
    expect(screen.getByTestId("search-count")).toHaveTextContent("1 / 2");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Details for 42")).toBeInTheDocument();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(await screen.findByText("Details for 5")).toBeInTheDocument();
  });

  it("reloads the graph when the filter changes", async () => {
    const { commands } = await import("@/ipc/bindings");
    const user = await openRepo();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByLabelText("First parent only"));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(commands.graphLoad).toHaveBeenLastCalledWith(
        "r1",
        expect.objectContaining({ firstParent: true }),
      ),
    );
  });

  it("invalidates queries by repo-changed scope", async () => {
    const { commands } = await import("@/ipc/bindings");
    await openRepo();
    await screen.findByTestId("repo-status");
    const count = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls.length;
    const before = {
      refs: count(commands.refsList),
      graph: count(commands.graphLoad),
      status: count(commands.status),
    };

    await act(async () => emitRepoChanged("r1", ["index"]));
    await waitFor(() => expect(count(commands.status)).toBe(before.status + 1));
    expect(count(commands.refsList)).toBe(before.refs);
    expect(count(commands.graphLoad)).toBe(before.graph);

    await act(async () => emitRepoChanged("r1", ["refs"]));
    await waitFor(() => expect(count(commands.refsList)).toBe(before.refs + 1));
    await waitFor(() => expect(count(commands.graphLoad)).toBe(before.graph + 1));

    // events for other repos are ignored
    await act(async () => emitRepoChanged("other", ["refs"]));
    expect(count(commands.refsList)).toBe(before.refs + 1);
  });
});

describe("graph performance", () => {
  it("only renders visible rows for a 100k-row repository", async () => {
    await installBackend(100_000);
    await openRepo();
    const grid = screen.getByRole("grid", { name: "Commit graph" });
    expect(grid).toHaveAttribute("aria-rowcount", "100000");
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(60);
  });
});
