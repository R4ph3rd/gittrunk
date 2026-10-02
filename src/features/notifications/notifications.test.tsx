import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/app/mockBindings";
import { installDomShims } from "@/app/testing";
import { toast } from "@/design/components";
import { forgeReady, renderWithClient } from "@/features/forge/testing";
import { commands } from "@/ipc/bindings";
import type { ForgeNotification, ForgeTokenSource, RepoInfo } from "@/ipc/bindings";
import { useNotificationsStore } from "@/stores/notifications";
import { useRepoStore } from "@/stores/repo";
import { NotificationsButton } from "./NotificationsButton";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();

const c = commands as unknown as ReturnType<typeof forgeReady> & {
  forgeNotifications: ReturnType<typeof vi.fn>;
  appOpenUrl: ReturnType<typeof vi.fn>;
};

const repo: RepoInfo = {
  id: "r1",
  path: "/work/demo",
  name: "demo",
  head: { kind: "detached", oid: "0".repeat(40) },
  state: "clean",
  isBare: false,
};

const note = (id: string, parts: Partial<ForgeNotification> = {}): ForgeNotification => ({
  id,
  title: `Title ${id}`,
  kind: "PullRequest",
  reason: "mention",
  repo: "acme/demo",
  unread: true,
  updatedAt: 1_700_000_000,
  url: `https://github.com/acme/demo/pull/${id}`,
  ...parts,
});

function setup(token: ForgeTokenSource, notes: ForgeNotification[] = []) {
  forgeReady(commands, { token });
  c.forgeNotifications.mockImplementation(() => ok(notes));
  c.appOpenUrl.mockImplementation(() => ok(null));
  return renderWithClient(<NotificationsButton />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationsStore.getState().reset();
  useRepoStore.setState({ repos: [repo], activeId: "r1" });
});

describe("NotificationsButton", () => {
  it("lists toasts with the repository name, marks them read and clears", async () => {
    const user = userEvent.setup();
    setup("none");
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();

    act(() => {
      toast.success("Fetched origin");
      toast.error("Push failed", { description: "rejected: non-fast-forward" });
    });
    const bell = await screen.findByRole("button", { name: "Notifications, 2 unread" });
    expect(bell).toHaveTextContent("2");

    await user.click(bell);
    expect(await screen.findByText("Push failed")).toBeInTheDocument();
    expect(screen.getByText("rejected: non-fast-forward")).toBeInTheDocument();
    expect(screen.getByText("Fetched origin")).toBeInTheDocument();
    expect(screen.getAllByText(/^demo · /)).toHaveLength(2);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Push failed")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Notifications" }));
    await user.click(await screen.findByRole("button", { name: "Clear" }));
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  });

  it("renders titles as plain text", async () => {
    const user = userEvent.setup();
    setup("none");
    act(() => {
      toast.info("<b>x</b>");
    });
    await user.click(await screen.findByRole("button", { name: /Notifications/ }));
    expect(await screen.findByText("<b>x</b>")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("lists GitHub notifications and opens one", async () => {
    const user = userEvent.setup();
    setup("forge", [
      note("1", { title: "<i>Fix</i> it" }),
      note("2", { url: null, kind: "Release", unread: false }),
    ]);
    const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    await user.click(bell);
    await user.click(await screen.findByRole("tab", { name: "GitHub (1)" }));
    const row = await screen.findByRole("button", { name: /<i>Fix<\/i> it/ });
    expect(document.querySelector("i")).toBeNull();
    expect(screen.getByText("Title 2")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /Title/ })).toHaveLength(0);
    await user.click(row);
    expect(c.appOpenUrl).toHaveBeenCalledWith("https://github.com/acme/demo/pull/1");
    await user.click(screen.getByRole("button", { name: "Open all on GitHub" }));
    expect(c.appOpenUrl).toHaveBeenCalledWith("https://github.com/notifications");
  });

  it("asks for a token and never queries without one", async () => {
    const user = userEvent.setup();
    setup("none");
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    await user.click(await screen.findByRole("tab", { name: "GitHub" }));
    expect(await screen.findByText("Connect GitHub to see your notifications")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add a GitHub token" })).toBeInTheDocument();
    expect(c.forgeNotifications).not.toHaveBeenCalled();
  });

  it("shows an unsupported error message", async () => {
    const user = userEvent.setup();
    forgeReady(commands, { token: "forge" });
    c.forgeNotifications.mockImplementation(() =>
      fail("unsupported", "Notifications need a classic token with the notifications scope"),
    );
    renderWithClient(<NotificationsButton />);
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    await user.click(await screen.findByRole("tab", { name: "GitHub" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Notifications need a classic token with the notifications scope",
    );
  });
});
