import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomShims, resetStore } from "@/app/testing";
import { commands } from "@/ipc/bindings";
import { NO_REPO, useNavStore } from "@/stores/nav";
import { setViewport } from "@/test/viewport";
import { CommitComments } from "./CommitComments";
import { forgeScreens } from "./mobile/contrib";
import { forgeReady, makeIssue, renderWithClient } from "./testing";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());
// The app bar pulls in repo, ops and palette state that is not under test here.
vi.mock("@/app/layout/ShellAppBar", () => ({
  ShellAppBar: ({
    title,
    actions,
    children,
  }: {
    title?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      {actions}
      {children}
    </header>
  ),
}));

installDomShims();

const c = commands as unknown as ReturnType<typeof forgeReady>;
const IssuesScreen = forgeScreens.tabs!.issues!;
const IssueScreen = forgeScreens.routes!.issue!;
const NewIssueScreen = forgeScreens.routes!.newIssue!;
const stack = () => useNavStore.getState().byRepo[NO_REPO]?.stack ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  useNavStore.setState({ byRepo: {} });
  setViewport(390, 844);
});

describe("mobile forge screens (390x844)", () => {
  it("lists issues, pushes the issue route and the new issue route", async () => {
    forgeReady(commands);
    const user = userEvent.setup();
    renderWithClient(<IssuesScreen repoId="r1" />);
    await user.click(await screen.findByRole("button", { name: /#2 Issue title 2/ }));
    expect(stack()).toEqual([{ name: "issue", number: 2 }]);
    await user.click(screen.getByRole("button", { name: "New issue" }));
    expect(stack().at(-1)).toEqual({ name: "newIssue" });
  });

  it("filters Open and Closed", async () => {
    forgeReady(commands);
    const user = userEvent.setup();
    renderWithClient(<IssuesScreen repoId="r1" />);
    await screen.findByText(/Issue title 1/);
    await user.click(screen.getByRole("radio", { name: "Closed" }));
    await waitFor(() =>
      expect(c.forgeIssues).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ state: "closed" }),
      ),
    );
  });

  it("hides New issue without a token", async () => {
    forgeReady(commands, { token: "none" });
    renderWithClient(<IssuesScreen repoId="r1" />);
    await screen.findByText(/Issue title 1/);
    expect(screen.queryByRole("button", { name: "New issue" })).not.toBeInTheDocument();
  });

  it("refetches on pull to refresh", async () => {
    forgeReady(commands, { issues: [makeIssue(1)] });
    const { container } = renderWithClient(<IssuesScreen repoId="r1" />);
    await screen.findByText(/Issue title 1/);
    const before = c.forgeIssues.mock.calls.length;
    const wrapper = container.querySelector<HTMLElement>("[class*='overscroll-y-contain']")!;
    await act(async () => {
      wrapper.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientY: 0 }));
      wrapper.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientY: 300 }));
      wrapper.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientY: 300 }));
    });
    await waitFor(() => expect(c.forgeIssues.mock.calls.length).toBeGreaterThan(before));
  });

  it("shows the issue with a composer that posts", async () => {
    forgeReady(commands);
    const user = userEvent.setup();
    renderWithClient(<IssueScreen repoId="r1" route={{ name: "issue", number: 1 }} />);
    expect(await screen.findByText("Issue body")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Add a comment" }), "hi");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(c.forgeIssueComment).toHaveBeenCalledWith("r1", 1, "hi"));
  });

  it("replaces the new issue form with the created issue", async () => {
    forgeReady(commands);
    useNavStore.getState().push(NO_REPO, { name: "newIssue" });
    const user = userEvent.setup();
    renderWithClient(<NewIssueScreen repoId="r1" route={{ name: "newIssue" }} />);
    await user.type(await screen.findByLabelText("Title"), "Bug");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(stack()).toEqual([{ name: "issue", number: 99 }]));
  });

  it("commit comments work at 390px", async () => {
    forgeReady(commands);
    renderWithClient(<CommitComments repoId="r1" oid="abc" />);
    expect(await screen.findByRole("textbox", { name: "Comment on this commit" })).toBeVisible();
  });
});
