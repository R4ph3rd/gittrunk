import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/app/mockBindings";
import { ANDROID_PLATFORM } from "@/app/platform";
import { installBackend, installDomShims, renderAppAt, resetStore } from "@/app/testing";
import { commands } from "@/ipc/bindings";
import { useNavStore } from "@/stores/nav";
import { makePull, pullsReady } from "./testing";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();
Element.prototype.scrollIntoView = vi.fn();

const c = commands as unknown as ReturnType<typeof pullsReady> & {
  platformInfo: ReturnType<typeof vi.fn>;
  checkout: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetStore();
  useNavStore.setState({ byRepo: {} });
  await installBackend();
  pullsReady(commands, {
    pulls: [makePull(1), makePull(2, { title: "Closed work", state: "closed" })],
  });
  c.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
});

async function openPullsSegment() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderAppAt(390, 844);
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("navigation", { name: "Primary" });
  await user.click(screen.getByRole("button", { name: "Issues" }));
  await user.click(await screen.findByRole("radio", { name: "Pull requests" }));
  return user;
}

describe("mobile pull requests (390x844, Android)", () => {
  it("lists pull requests under the Issues tab and filters closed ones", async () => {
    const user = await openPullsSegment();
    expect(await screen.findByRole("button", { name: /#1 Pull title 1/ })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Closed" }));
    expect(await screen.findByRole("button", { name: /#2 Closed work/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(c.forgePulls).toHaveBeenCalledWith("r1", expect.objectContaining({ state: "closed" })),
    );
  });

  it("pushes the pull route, shows the detail and goes back", async () => {
    const user = await openPullsSegment();
    await user.click(await screen.findByRole("button", { name: /#1 Pull title 1/ }));
    expect(await screen.findByRole("heading", { name: /Pull title 1/ })).toBeInTheDocument();
    expect(screen.getByText("Pull request")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add a comment" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Check out branch" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("radio", { name: "Pull requests" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Add a comment" })).toBeNull();
  });
});
