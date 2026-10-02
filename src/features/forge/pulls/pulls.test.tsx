import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { fail, ok } from "@/app/mockBindings";
import { installDomShims, resetStore } from "@/app/testing";
import { commands } from "@/ipc/bindings";
import { useWorkspaceStore } from "@/stores/workspace";
import { makeComment, makeStatus, renderWithClient } from "../testing";
import { PullMainView } from "./PullMainView";
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

describe("PullMainView", () => {
  const ca = commands as unknown as { appOpenUrl: ReturnType<typeof vi.fn> };

  it("filters by state and opens a pull request", async () => {
    pullsReady(commands, {
      pulls: [makePull(1), makePull(3, { state: "merged", title: "Old work" })],
    });
    const user = userEvent.setup();
    renderWithClient(<PullMainView repoId="r1" view={{ kind: "pulls" }} />);
    await screen.findByText("Pull title 1");
    expect(c.forgePulls).toHaveBeenCalledWith("r1", expect.objectContaining({ state: "open" }));
    await user.click(screen.getByRole("radio", { name: "Closed" }));
    await waitFor(() =>
      expect(c.forgePulls).toHaveBeenCalledWith("r1", expect.objectContaining({ state: "closed" })),
    );
    await user.click(await screen.findByRole("button", { name: "Old work" }));
    expect(top()).toEqual({ kind: "pull", number: 3 });
  });

  it("shows the detail with stats and renders bodies as plain text", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    pullsReady(commands, { detail: { body: evil, comments: [makeComment("9", evil)] } });
    const { container } = renderWithClient(
      <PullMainView repoId="r1" view={{ kind: "pull", number: 1 }} />,
    );
    await waitFor(() => expect(screen.getAllByText(evil)).toHaveLength(2));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/ada wants to merge 3 commits into/)).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("−4")).toBeInTheDocument();
  });

  it("opens the pull request on GitHub and toasts a failure", async () => {
    pullsReady(commands);
    const user = userEvent.setup();
    renderWithClient(<PullMainView repoId="r1" view={{ kind: "pull", number: 1 }} />);
    await user.click(await screen.findByRole("button", { name: "Open on GitHub" }));
    expect(ca.appOpenUrl).toHaveBeenCalledWith("https://github.com/acme/demo/pull/1");
    ca.appOpenUrl.mockImplementation(() => fail("invalidInput", "Blocked"));
    await user.click(screen.getByRole("button", { name: "Open on GitHub" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not open the link: Blocked"),
    );
  });

  it("posts a comment", async () => {
    pullsReady(commands);
    const user = userEvent.setup();
    renderWithClient(<PullMainView repoId="r1" view={{ kind: "pull", number: 1 }} />);
    const box = await screen.findByRole("textbox", { name: "Add a comment" });
    await user.type(box, "Looks good");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(c.forgePullComment).toHaveBeenCalledWith("r1", 1, "Looks good"));
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("disables the composer without a token", async () => {
    pullsReady(commands, { token: "none" });
    renderWithClient(<PullMainView repoId="r1" view={{ kind: "pull", number: 1 }} />);
    expect(await screen.findByRole("textbox", { name: "Add a comment" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add a GitHub token" })).toBeInTheDocument();
  });

  it("explains a missing or unsupported remote", async () => {
    c.forgeStatus.mockImplementation(() =>
      ok({ repo: null, supported: false, tokenSource: "none" }),
    );
    const first = renderWithClient(<PullMainView repoId="r1" view={{ kind: "pulls" }} />);
    expect(await screen.findByText("Pull requests need a GitHub remote")).toBeInTheDocument();
    first.unmount();
    c.forgeStatus.mockImplementation(() =>
      ok(makeStatus({ kind: "gitlab", supported: false, token: "none" })),
    );
    renderWithClient(<PullMainView repoId="r1" view={{ kind: "pulls" }} />);
    expect(
      await screen.findByText("GitLab merge requests are not supported yet"),
    ).toBeInTheDocument();
  });
});
