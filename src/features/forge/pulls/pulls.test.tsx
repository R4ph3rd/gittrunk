import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/app/mockBindings";
import { installDomShims, resetStore } from "@/app/testing";
import { commands } from "@/ipc/bindings";
import { useWorkspaceStore } from "@/stores/workspace";
import { makeStatus, renderWithClient } from "../testing";
import { PullsSection } from "./PullsSection";
import { makeBranch, makePull, pullsReady } from "./testing";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();

const c = commands as unknown as ReturnType<typeof pullsReady> & {
  graphLoad: ReturnType<typeof vi.fn>;
};
const top = () => useWorkspaceStore.getState().stacks["r1"]?.at(-1);

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  c.graphLoad.mockImplementation(() =>
    ok({ rowCount: 0, laneCount: 1, headRow: 0, refColors: [] }),
  );
});

describe("PullsSection", () => {
  it("shows a line without a remote and for GitLab", async () => {
    c.forgeStatus.mockImplementation(() =>
      ok({ repo: null, supported: false, tokenSource: "none" }),
    );
    const first = renderWithClient(<PullsSection repoId="r1" />);
    expect(await screen.findByText("Pull requests need a GitHub remote")).toBeInTheDocument();
    first.unmount();
    c.forgeStatus.mockImplementation(() =>
      ok(makeStatus({ kind: "gitlab", supported: false, token: "none" })),
    );
    renderWithClient(<PullsSection repoId="r1" />);
    expect(
      await screen.findByText("GitLab merge requests are not supported yet"),
    ).toBeInTheDocument();
    expect(c.forgePulls).not.toHaveBeenCalled();
  });

  it("lists at most 10 pull requests with a draft badge and opens one", async () => {
    const pulls = Array.from({ length: 12 }, (_, i) =>
      makePull(i + 1, i === 0 ? { draft: true } : {}),
    );
    pullsReady(commands, { pulls });
    const user = userEvent.setup();
    renderWithClient(<PullsSection repoId="r1" />);
    const first = await screen.findByRole("button", { name: /#1 Pull title 1/ });
    expect(within(first).getByText("Draft")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^#\d+ Pull title/ })).toHaveLength(10);
    await user.click(screen.getByRole("button", { name: /#2 Pull title 2/ }));
    expect(top()).toEqual({ kind: "pull", number: 2 });
    await user.click(screen.getByRole("button", { name: "Show all pull requests" }));
    expect(top()).toEqual({ kind: "pulls" });
  });

  it("colors the head chip by lane, neutral for forks and unknown branches", async () => {
    pullsReady(commands, {
      pulls: [
        makePull(1),
        makePull(2, {
          head: makeBranch("fork-branch", { isFork: true, label: "bob:fork-branch" }),
        }),
        makePull(3),
      ],
    });
    c.graphLoad.mockImplementation(() =>
      ok({
        rowCount: 0,
        laneCount: 1,
        headRow: 0,
        refColors: [
          { fullName: "refs/remotes/origin/feature-1", color: 2 },
          { fullName: "refs/remotes/origin/fork-branch", color: 5 },
        ],
      }),
    );
    renderWithClient(<PullsSection repoId="r1" />);
    await screen.findByRole("button", { name: /#1 / });
    await waitFor(() =>
      expect(screen.getByTitle("acme:feature-1").style.color).toBe("var(--lane-2)"),
    );
    expect(screen.getByTitle("bob:fork-branch").style.color).toBe("");
    expect(screen.getByTitle("acme:feature-3").style.color).toBe("");
  });
});
