import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/app/mockBindings";
import { installDomShims, resetStore } from "@/app/testing";
import { commands } from "@/ipc/bindings";
import { useSettingsStore } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";
import { CommitComments } from "./CommitComments";
import { ForgeMainView } from "./ForgeMainView";
import { IssuesSection } from "./IssuesSection";
import { forgeReady, makeComment, makeIssue, makeStatus, renderWithClient } from "./testing";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();

const c = commands as unknown as ReturnType<typeof forgeReady>;
const top = () => useWorkspaceStore.getState().stacks["r1"]?.at(-1);

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  useSettingsStore.setState({ open: false, section: "general" });
});

describe("IssuesSection", () => {
  it("shows a line without a remote", async () => {
    c.forgeStatus.mockImplementation(() =>
      ok({ repo: null, supported: false, tokenSource: "none" }),
    );
    renderWithClient(<IssuesSection repoId="r1" />);
    expect(await screen.findByText("Issues need a GitHub remote")).toBeInTheDocument();
  });

  it("shows a line for GitLab", async () => {
    c.forgeStatus.mockImplementation(() =>
      ok(makeStatus({ kind: "gitlab", supported: false, token: "none" })),
    );
    renderWithClient(<IssuesSection repoId="r1" />);
    expect(await screen.findByText("GitLab issues are not supported yet")).toBeInTheDocument();
    expect(c.forgeIssues).not.toHaveBeenCalled();
  });

  it("lists issues, opens one and offers New issue with a token", async () => {
    forgeReady(commands);
    const user = userEvent.setup();
    renderWithClient(<IssuesSection repoId="r1" />);
    await user.click(await screen.findByRole("button", { name: "#2 Issue title 2" }));
    expect(top()).toEqual({ kind: "issue", number: 2 });
    await user.click(screen.getByRole("button", { name: "New issue" }));
    expect(top()).toEqual({ kind: "newIssue" });
    await user.click(screen.getByRole("button", { name: "Show all issues" }));
    expect(top()).toEqual({ kind: "issues" });
  });

  it("hides + without a token", async () => {
    forgeReady(commands, { token: "none" });
    renderWithClient(<IssuesSection repoId="r1" />);
    await screen.findByRole("button", { name: "#1 Issue title 1" });
    expect(screen.queryByRole("button", { name: "New issue" })).not.toBeInTheDocument();
  });

  it("offers the token button on an auth error", async () => {
    forgeReady(commands);
    c.forgeIssues.mockImplementation(() => fail("authRequired", "Sign in to GitHub"));
    const user = userEvent.setup();
    renderWithClient(<IssuesSection repoId="r1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in to GitHub");
    await user.click(screen.getByRole("button", { name: "Add a GitHub token" }));
    expect(useSettingsStore.getState()).toMatchObject({ open: true, section: "integrations" });
  });
});

describe("ForgeMainView", () => {
  it("filters issues by state and loads more", async () => {
    forgeReady(commands);
    c.forgeIssues.mockImplementation((_r: string, q: { state: string; page: number }) =>
      ok(
        q.page === 1
          ? {
              items: [makeIssue(1, { state: q.state === "closed" ? "closed" : "open" })],
              nextPage: 2,
            }
          : { items: [makeIssue(5)], nextPage: null },
      ),
    );
    const user = userEvent.setup();
    renderWithClient(<ForgeMainView repoId="r1" view={{ kind: "issues" }} />);
    await screen.findByText("Issue title 1");
    expect(c.forgeIssues).toHaveBeenCalledWith("r1", expect.objectContaining({ state: "open" }));
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Issue title 5");
    await user.click(screen.getByRole("radio", { name: "Closed" }));
    await waitFor(() =>
      expect(c.forgeIssues).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ state: "closed" }),
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Issue title 1/ }));
    expect(top()).toEqual({ kind: "issue", number: 1 });
  });

  it("renders bodies and comments as plain text", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    forgeReady(commands, { detail: { body: evil, comments: [makeComment("9", evil)] } });
    const { container } = renderWithClient(
      <ForgeMainView repoId="r1" view={{ kind: "issue", number: 1 }} />,
    );
    await waitFor(() => expect(screen.getAllByText(evil)).toHaveLength(2));
    expect(container.querySelector("img[src='x']")).toBeNull();
  });

  it("posts a comment with Ctrl+Enter and clears the composer", async () => {
    forgeReady(commands);
    const user = userEvent.setup();
    renderWithClient(<ForgeMainView repoId="r1" view={{ kind: "issue", number: 1 }} />);
    const box = await screen.findByRole("textbox", { name: "Add a comment" });
    await user.type(box, "Looks good");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(c.forgeIssueComment).toHaveBeenCalledWith("r1", 1, "Looks good"));
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("disables the composer without a token", async () => {
    forgeReady(commands, { token: "none" });
    renderWithClient(<ForgeMainView repoId="r1" view={{ kind: "issue", number: 1 }} />);
    expect(await screen.findByRole("textbox", { name: "Add a comment" })).toBeDisabled();
    expect(screen.getByText("Commenting needs a GitHub token.")).toBeInTheDocument();
  });

  it("validates a new issue and opens the created one", async () => {
    forgeReady(commands);
    useWorkspaceStore.getState().open("r1", { kind: "newIssue" });
    const user = userEvent.setup();
    renderWithClient(<ForgeMainView repoId="r1" view={{ kind: "newIssue" }} />);
    await user.click(await screen.findByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Title is required");
    expect(c.forgeIssueCreate).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Title"), "Crash on start");
    await user.type(screen.getByLabelText("Description"), "Steps");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(c.forgeIssueCreate).toHaveBeenCalledWith("r1", {
        title: "Crash on start",
        body: "Steps",
      }),
    );
    await waitFor(() => expect(top()).toEqual({ kind: "issue", number: 99 }));
    expect(useWorkspaceStore.getState().stacks["r1"]).toHaveLength(1);
  });

  it("Cancel goes back", async () => {
    forgeReady(commands);
    useWorkspaceStore.getState().open("r1", { kind: "newIssue" });
    const user = userEvent.setup();
    renderWithClient(<ForgeMainView repoId="r1" view={{ kind: "newIssue" }} />);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(top()).toBeUndefined();
  });
});

describe("CommitComments", () => {
  it("renders nothing without a forge", async () => {
    c.forgeStatus.mockImplementation(() =>
      ok({ repo: null, supported: false, tokenSource: "none" }),
    );
    const { container } = renderWithClient(<CommitComments repoId="r1" oid="abc" />);
    await waitFor(() => expect(c.forgeStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("lists comments and posts one", async () => {
    forgeReady(commands);
    c.forgeCommitComments.mockImplementation(() => ok([makeComment("1", "nice")]));
    const user = userEvent.setup();
    renderWithClient(<CommitComments repoId="r1" oid="abc" />);
    expect(await screen.findByText("nice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Comments \(1\)/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.type(screen.getByRole("textbox", { name: "Comment on this commit" }), "thanks");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(c.forgeCommitComment).toHaveBeenCalledWith("r1", "abc", "thanks"));
  });

  it("shows a muted note when the commit is not on GitHub", async () => {
    forgeReady(commands);
    c.forgeCommitComments.mockImplementation(() => fail("invalidInput", "No commit found"));
    renderWithClient(<CommitComments repoId="r1" oid="abc" />);
    const note = await screen.findByText("This commit is not on GitHub");
    expect(note).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(note.closest("section")!).queryByRole("textbox")).not.toBeInTheDocument();
  });
});
