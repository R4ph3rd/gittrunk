import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/app/mockBindings";
import { installDomShims, renderAppAt, resetStore } from "@/app/testing";
import { useNavStore } from "@/stores/nav";
import { resetViewport } from "@/test/viewport";
import { conflictFile, installOpsBackend, type OpsBackend } from "../../testing";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();
Element.prototype.scrollIntoView = vi.fn();

let backend: OpsBackend;

const MERGED = "top\n<<<<<<< main\nours line\n=======\ntheirs line\n>>>>>>> feature\nbottom\n";

async function openApp(files: string[]) {
  backend.setOperation("merge", files);
  backend.commands.conflictFile!.mockImplementation((_r: string, path: string) =>
    ok(conflictFile({ path, merged: MERGED, oursLabel: "main" })),
  );
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderAppAt(390, 844);
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("navigation", { name: "Primary" });
  return user;
}

beforeEach(async () => {
  resetStore();
  useNavStore.setState({ byRepo: {} });
  vi.clearAllMocks();
  backend = await installOpsBackend();
});

afterEach(() => resetViewport());

describe("conflicts on mobile", () => {
  it("shows Resolve in the compact operation banner", async () => {
    const user = await openApp(["a.ts"]);
    const banner = await screen.findByRole("region", { name: "Operation in progress" });
    expect(banner).toHaveTextContent("Merging into main");
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    expect(useNavStore.getState().byRepo["r1"]?.stack).toEqual([{ name: "conflicts" }]);
  });

  it("keeps Continue disabled while files are unresolved", async () => {
    await openApp(["a.ts", "b.ts"]);
    act(() => useNavStore.getState().push("r1", { name: "conflicts" }));
    expect(await screen.findByRole("button", { name: /^a\.ts conflicted/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("enables Continue when nothing is left", async () => {
    await openApp([]);
    act(() => useNavStore.getState().push("r1", { name: "conflicts" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });

  it("resolves a hunk with Use theirs through conflict_resolve", async () => {
    const user = await openApp(["a.ts"]);
    act(() => useNavStore.getState().push("r1", { name: "conflict", path: "a.ts" }));
    await screen.findByRole("region", { name: "Conflict 1 of 1" });
    await user.click(screen.getByRole("button", { name: "Use theirs" }));
    await waitFor(() =>
      expect(backend.commands.conflictResolve).toHaveBeenCalledWith("r1", "a.ts", {
        kind: "content",
        content: "top\ntheirs line\nbottom\n",
      }),
    );
  });
});
