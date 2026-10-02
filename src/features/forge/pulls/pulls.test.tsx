import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { emitOpFinished, fail, ok } from "@/app/mockBindings";
import { ANDROID_PLATFORM } from "@/app/platform";
import {
  installBackend,
  installDomShims,
  oid,
  renderApp,
  repoInfo,
  resetStore,
} from "@/app/testing";
import { commands } from "@/ipc/bindings";
import { openPull, useWorkspaceStore } from "@/stores/workspace";
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

describe("in the app", () => {
  const app = commands as unknown as ReturnType<typeof pullsReady> & {
    refsList: ReturnType<typeof vi.fn>;
    checkout: ReturnType<typeof vi.fn>;
    fetch: ReturnType<typeof vi.fn>;
    platformInfo: ReturnType<typeof vi.fn>;
  };

  const branch = (name: string, remote: string | null) => ({
    name: remote ? `${remote}/${name}` : name,
    fullName: remote ? `refs/remotes/${remote}/${name}` : `refs/heads/${name}`,
    oid: oid(1),
    upstream: null,
    ahead: 0,
    behind: 0,
    isHead: false,
    remote,
  });
  const setRefs = (parts: { local?: string[]; remote?: string[] }) =>
    app.refsList.mockImplementation(() =>
      ok({
        head: repoInfo.head,
        local: (parts.local ?? []).map((n) => branch(n, null)),
        remote: (parts.remote ?? []).map((n) => branch(n, "origin")),
        tags: [],
        stashes: [],
      }),
    );

  async function openPullView(n: number, pulls = [makePull(1), makePull(2)]) {
    await installBackend();
    pullsReady(commands, { pulls });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    await screen.findByRole("grid", { name: "Commit graph" });
    act(() => openPull("r1", n));
    await screen.findByRole("button", { name: "Check out branch" }).catch(() => null);
    return user;
  }

  it("lists pull requests above Issues, opens the detail and Esc goes back", async () => {
    await installBackend();
    pullsReady(commands);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    const nav = await screen.findByRole("navigation", { name: "References" });
    const row = await within(nav).findByRole("button", { name: /#2 Pull title 2/ });
    const pullsTitle = within(nav).getByRole("button", { name: "Pull requests" });
    const issuesTitle = within(nav).getByRole("button", { name: "Issues" });
    expect(
      pullsTitle.compareDocumentPosition(issuesTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(row);
    const view = await screen.findByTestId("pull-main-view");
    await waitFor(() => expect(view).toHaveAttribute("data-view", "pull"));
    expect(screen.getByText("Pull request #2")).toBeInTheDocument();
    fireEvent.keyDown(view, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("pull-main-view")).toBeNull());
    await user.click(within(nav).getByRole("button", { name: "Show all pull requests" }));
    await screen.findByRole("list", { name: "Pull requests" });
    await user.click(screen.getByRole("radio", { name: "Closed" }));
    await waitFor(() =>
      expect(c.forgePulls).toHaveBeenCalledWith("r1", expect.objectContaining({ state: "closed" })),
    );
  });

  it("checks out an existing local branch", async () => {
    const user = await openPullView(1);
    setRefs({ local: ["feature-1"] });
    await user.click(await screen.findByRole("button", { name: "Check out branch" }));
    await waitFor(() =>
      expect(app.checkout).toHaveBeenCalledWith("r1", { kind: "branch", name: "feature-1" }, false),
    );
    expect(toast.success).toHaveBeenCalledWith("Checked out feature-1");
  });

  it("creates a tracking branch from the remote branch", async () => {
    const user = await openPullView(1);
    setRefs({ remote: ["feature-1"] });
    await user.click(await screen.findByRole("button", { name: "Check out branch" }));
    await waitFor(() =>
      expect(app.checkout).toHaveBeenCalledWith(
        "r1",
        { kind: "remoteBranch", name: "origin/feature-1", localName: "feature-1" },
        false,
      ),
    );
  });

  it("fetches first when the branch is unknown, then checks it out", async () => {
    const user = await openPullView(1);
    setRefs({});
    await user.click(await screen.findByRole("button", { name: "Check out branch" }));
    await waitFor(() =>
      expect(app.fetch).toHaveBeenCalledWith("r1", { remote: "origin", prune: false, tags: false }),
    );
    expect(app.checkout).not.toHaveBeenCalled();
    setRefs({ remote: ["feature-1"] });
    act(() => emitOpFinished("op-fetch"));
    await waitFor(() =>
      expect(app.checkout).toHaveBeenCalledWith(
        "r1",
        { kind: "remoteBranch", name: "origin/feature-1", localName: "feature-1" },
        false,
      ),
    );
  });

  it("reports a branch that is still missing after the fetch", async () => {
    const user = await openPullView(1);
    setRefs({});
    await user.click(await screen.findByRole("button", { name: "Check out branch" }));
    await waitFor(() => expect(app.fetch).toHaveBeenCalled());
    act(() => emitOpFinished("op-fetch"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Branch feature-1 not found on origin"),
    );
    expect(app.checkout).not.toHaveBeenCalled();
  });

  it("toasts a checkout failure", async () => {
    const user = await openPullView(1);
    setRefs({ local: ["feature-1"] });
    app.checkout.mockImplementation(() => fail("conflict", "Your changes would be overwritten"));
    await user.click(await screen.findByRole("button", { name: "Check out branch" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not check out feature-1: Your changes would be overwritten",
      ),
    );
  });

  it("offers no checkout for a fork", async () => {
    await openPullView(3, [
      makePull(3, { head: makeBranch("patch", { isFork: true, label: "bob:patch" }) }),
    ]);
    expect(await screen.findByText(/From a fork: open it on GitHub/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check out branch" })).toBeNull();
  });

  it("shows Checked out when HEAD is on the head branch", async () => {
    await installBackend();
    pullsReady(commands, { pulls: [makePull(1, { head: makeBranch("main") })] });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    await screen.findByRole("grid", { name: "Commit graph" });
    act(() => openPull("r1", 1));
    expect(await screen.findByRole("button", { name: "Checked out" })).toBeDisabled();
  });

  it("keeps the section, detail, checkout and composer on Android", async () => {
    await installBackend();
    pullsReady(commands);
    app.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
    setRefs({ local: ["feature-1"] });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp();
    await user.click(await screen.findByRole("button", { name: /demo/ }));
    const nav = await screen.findByRole("navigation", { name: "References" });
    await user.click(await within(nav).findByRole("button", { name: /#1 Pull title 1/ }));
    expect(await screen.findByRole("textbox", { name: "Add a comment" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Check out branch" }));
    await waitFor(() => expect(app.checkout).toHaveBeenCalled());
  });
});
