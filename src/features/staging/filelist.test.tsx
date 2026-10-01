import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { change, installBackend, installDomShims, makeStatus, ok } from "@/app/testing";
import { FileList } from "./FileList";
import { FILE_LIST_MODE_KEY, useFileListMode } from "./fileListMode";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();

const status = () =>
  makeStatus({
    unstaged: [change("src/a.ts"), change("src/deep/b.ts"), change("README.md")],
    staged: [change("lib/c.ts", "added")],
  });

async function setup(s = status()) {
  const commands = await installBackend();
  commands.stagePaths.mockImplementation(() => ok(null));
  commands.unstagePaths.mockImplementation(() => ok(null));
  const onOpen = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={client}>
      <FileList repoId="r1" status={s} open={null} onOpen={onOpen} />
    </QueryClientProvider>
  );
  const view = render(ui());
  return { commands, onOpen, view, ui, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

beforeEach(() => {
  window.localStorage.clear();
  useFileListMode.setState({ mode: "list", collapsed: new Set() });
});

describe("FileList list mode", () => {
  it("keeps the listbox DOM contract", async () => {
    await setup();
    const list = screen.getByRole("listbox", { name: "Changed files" });
    const rows = within(list).getAllByRole("option");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveAttribute("id", "staging-row-0");
    expect(rows[0]).toHaveAttribute("data-section", "unstaged");
    expect(rows[0]).toHaveAttribute("data-path", "src/a.ts");
    expect(rows[0]).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("button", { name: "Stage all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unstage all" })).toBeInTheDocument();
  });

  it("renders section blocks with accents and only when non-empty", async () => {
    await setup(makeStatus({ unstaged: [change("a.ts")], staged: [change("b.ts")] }));
    expect(screen.queryByTestId("section-conflicted")).toBeNull();
    expect(screen.getByTestId("section-unstaged")).toHaveClass("border-l-2", "border-unstaged");
    expect(screen.getByTestId("section-staged")).toHaveClass("border-staged", "bg-staged-bg");
  });

  it("stages the focused file with Space", async () => {
    const { commands, user } = await setup();
    await user.tab();
    await user.keyboard(" ");
    await waitFor(() => expect(commands.stagePaths).toHaveBeenCalledTimes(1));
  });
});

describe("FileList mode toggle", () => {
  it("switches modes and persists across remounts", async () => {
    const { user, view, ui } = await setup();
    const tree = screen.getByRole("button", { name: "Show as tree" });
    expect(tree).toHaveAttribute("aria-pressed", "false");
    await user.click(tree);
    expect(screen.getByRole("tree", { name: "Changed files" })).toBeInTheDocument();
    expect(window.localStorage.getItem(FILE_LIST_MODE_KEY)).toBe("tree");
    view.unmount();
    render(ui());
    expect(screen.getByRole("tree")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show as tree" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows the toggle in the Staged header when Unstaged is empty", async () => {
    await setup(makeStatus({ staged: [change("b.ts")] }));
    const header = within(screen.getByTestId("section-staged"));
    expect(header.getByRole("button", { name: "Show as list" })).toBeInTheDocument();
    expect(header.getByRole("button", { name: "Show as tree" })).toBeInTheDocument();
  });

  it("shows the toggle once, in the Unstaged header", async () => {
    await setup();
    expect(screen.getAllByRole("button", { name: "Show as tree" })).toHaveLength(1);
    expect(
      within(screen.getByTestId("section-unstaged")).getByRole("button", { name: "Show as tree" }),
    ).toBeInTheDocument();
  });
});

describe("FileList tree mode", () => {
  beforeEach(() => useFileListMode.setState({ mode: "tree" }));

  it("renders folders and files with ARIA roles", async () => {
    await setup();
    const items = within(screen.getByRole("tree", { name: "Changed files" })).getAllByRole(
      "treeitem",
    );
    const src = items.find((i) => i.getAttribute("data-path") === "src");
    expect(src).toHaveAttribute("aria-level", "1");
    expect(src).toHaveAttribute("aria-expanded", "true");
    const a = items.find((i) => i.getAttribute("data-path") === "src/a.ts");
    expect(a).toHaveAttribute("aria-level", "2");
    expect(a).toHaveAttribute("aria-selected", "false");
    expect(a).not.toHaveAttribute("aria-expanded");
  });

  it("collapses with Left, expands with Right, and stages a folder in one call", async () => {
    const { user, commands } = await setup();
    const src = () =>
      screen.getAllByRole("treeitem").find((i) => i.getAttribute("data-path") === "src");
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(src()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("a.ts")).toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(src()).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tree")).toHaveAttribute("aria-activedescendant", "staging-row-1");
    // "src/deep" is expanded: the first Left collapses it, the second moves to the parent.
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tree")).toHaveAttribute("aria-activedescendant", "staging-row-0");
    await user.keyboard(" ");
    await waitFor(() => expect(commands.stagePaths).toHaveBeenCalledTimes(1));
    expect(commands.stagePaths.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["src/a.ts", "src/deep/b.ts"]),
    );
  });

  it("opens a file with Enter", async () => {
    const { user, onOpen } = await setup();
    await user.tab();
    // src, src/deep, src/deep/b.ts
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onOpen).toHaveBeenCalledWith({ path: "src/deep/b.ts", staged: false });
  });

  it("unstages a staged file with Space", async () => {
    const { user, commands } = await setup();
    await user.click(screen.getByRole("treeitem", { name: "lib/c.ts" }));
    await user.keyboard(" ");
    await waitFor(() => expect(commands.unstagePaths).toHaveBeenCalledTimes(1));
  });
});
