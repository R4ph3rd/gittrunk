import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomShims, makeRow, ok, renderApp, resetStore } from "@/app/testing";
import type { GraphRow, RefLabel } from "@/ipc/bindings";
import { useRepoStore } from "@/stores/repo";
import { resetAvatarImages } from "./avatarImages";
import { RefBadge } from "./RefBadge";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();

const main: RefLabel = {
  name: "main",
  fullName: "refs/heads/main",
  kind: "localBranch",
  isHead: true,
};
const dev: RefLabel = {
  name: "dev",
  fullName: "refs/heads/dev",
  kind: "localBranch",
  isHead: false,
};
const tag: RefLabel = { name: "v1", fullName: "refs/tags/v1", kind: "tag", isHead: false };

async function backend(refs: RefLabel[]) {
  const { installBackend } = await import("@/app/testing");
  const commands = await installBackend(5);
  const rows = (start: number, len: number): GraphRow[] =>
    Array.from({ length: Math.min(len, 5 - start) }, (_, k) => {
      const r = makeRow(start + k, 5);
      return { ...r, color: 3, refs: start + k === 0 ? refs : [] };
    });
  (
    commands.graphRows as unknown as { mockImplementation: (f: unknown) => void }
  ).mockImplementation((_r: string, start: number, len: number) => ok(rows(start, len)));
  return commands;
}

async function openRepo() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderApp();
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  return screen.findByRole("grid", { name: "Commit graph" });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  resetAvatarImages();
});

describe("refs column", () => {
  it("renders chips before the summary, with no author/date/oid cells", async () => {
    await backend([dev, main, tag]);
    const grid = await openRepo();
    await screen.findByText("Commit number 0");
    const row = grid.querySelector('[data-index="0"]') as HTMLElement;
    const cells = within(row).getAllByRole("gridcell");
    expect(cells[0]).toHaveAttribute("data-testid", "refs-cell");
    // HEAD's branch is sorted first, then local branches.
    const chips = [...cells[0]!.querySelectorAll("[data-kind]")].map((c) => c.textContent);
    expect(chips).toEqual(["main", "dev"]);
    const overflow = within(cells[0]!).getByText("+1");
    expect(overflow).toHaveAttribute("title", "v1");
    expect(cells[1]).toHaveTextContent("Commit number 0");
    // One visually hidden cell carries author, relative date and short oid.
    expect(cells).toHaveLength(3);
    expect(cells[2]).toHaveClass("sr-only");
    expect(cells[2]).toHaveTextContent(/^Ada, .+, 0000000$/);
    expect(row.querySelectorAll('[role="gridcell"]:not(.sr-only)')).toHaveLength(2);
  });

  it("keeps the branch label draggable with the exact name as text", async () => {
    await backend([main]);
    const grid = await openRepo();
    await screen.findByText("Commit number 0");
    const chip = grid.querySelector('span[data-kind="localBranch"]') as HTMLElement;
    expect(chip.textContent).toBe("main");
    expect(chip).toHaveAttribute("title", "refs/heads/main");
  });
});

describe("RefBadge", () => {
  function renderBadge(
    ui: React.ReactElement,
    hasColor: boolean,
    colors: { fullName: string; color: number }[] = [],
  ) {
    return import("@/app/testing").then(async ({ installBackend }) => {
      const commands = await installBackend(1);
      (
        commands.graphLoad as unknown as { mockImplementation: (f: unknown) => void }
      ).mockImplementation(() => ok({ rowCount: 1, laneCount: 1, headRow: 0, refColors: colors }));
      useRepoStore.setState({ activeId: "r1" });
      const client = new QueryClient();
      const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
      if (!hasColor) {
        await vi.waitFor(() => expect(commands.graphLoad).toHaveBeenCalled());
      }
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      return view;
    });
  }

  it("uses the color prop", async () => {
    await renderBadge(<RefBadge label={dev} color={5} />, true);
    const el = screen.getByText("dev").closest("[data-kind]") as HTMLElement;
    expect(el.style.color).toBe("var(--lane-5)");
    expect(el.style.borderColor).toBe("var(--lane-5)");
    expect(el).toHaveAttribute("data-kind", "localBranch");
  });

  it("fills the HEAD branch with its lane color", async () => {
    await renderBadge(<RefBadge label={main} color={2} />, true);
    const el = screen.getByText("main").closest("[data-kind]") as HTMLElement;
    expect(el.style.backgroundColor).toBe("var(--lane-2)");
    expect(el).toHaveAttribute("data-head", "true");
  });

  it("looks the color up by full name when omitted", async () => {
    await renderBadge(<RefBadge label={dev} />, false, [{ fullName: "refs/heads/dev", color: 6 }]);
    const el = screen.getByText("dev").closest("[data-kind]") as HTMLElement;
    await vi.waitFor(() => expect(el.style.color).toBe("var(--lane-6)"));
  });

  it("is neutral for unknown refs", async () => {
    await renderBadge(<RefBadge label={tag} />, false);
    const el = screen.getByText("v1").closest("[data-kind]") as HTMLElement;
    expect(el.style.color).toBe("");
    expect(el.className).toContain("text-warning");
  });
});

describe("avatar loader", () => {
  it("requests visible emails once and not again once cached", async () => {
    const commands = await backend([main]);
    await openRepo();
    await screen.findByText("Commit number 0");
    await vi.waitFor(() => expect(commands.avatarsGet).toHaveBeenCalled());
    const calls = commands.avatarsGet.mock.calls.filter(
      (c: unknown[]) => (c[0] as unknown[]).length > 0,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual([{ kind: "email", email: "ada@example.com" }]);
    expect(calls[0]![1]).toBe(64);
  });
});
