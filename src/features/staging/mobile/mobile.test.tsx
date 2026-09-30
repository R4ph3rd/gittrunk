import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/app/mockBindings";
import { ANDROID_PLATFORM } from "@/app/platform";
import {
  change,
  installBackend,
  installDomShims,
  makeStatus,
  renderAppAt,
  resetStore,
} from "@/app/testing";
import { openAskAi } from "@/features/ai";
import { useAiStore } from "@/stores/ai";
import { useComposerStore } from "@/stores/composer";
import { useNavStore } from "@/stores/nav";
import { resetViewport } from "@/test/viewport";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work/demo")) }));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();
Element.prototype.scrollIntoView = vi.fn();

type Backend = Awaited<ReturnType<typeof installBackend>>;
let backend: Backend;

const dirty = () =>
  makeStatus({
    unstaged: [change("src/a.ts"), change("README.md")],
    staged: [change("src/b.ts", "added")],
  });

async function openApp(width = 390, height = 844) {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderAppAt(width, height);
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  return user;
}

async function openChanges() {
  const user = await openApp();
  await screen.findByRole("navigation", { name: "Primary" });
  act(() => useNavStore.getState().setTab("r1", "changes"));
  await screen.findByRole("group", { name: "Changed files" });
  return user;
}

const push = (route: Parameters<ReturnType<typeof useNavStore.getState>["push"]>[1]) =>
  act(() => useNavStore.getState().push("r1", route));

function swipe(path: string, from: number, to: number) {
  const content = document.querySelector(`[data-path="${path}"]`)!.closest("[data-swipe-content]")!;
  fireEvent.pointerDown(content, { clientX: from, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(content, { clientX: to, clientY: 0, pointerId: 1 });
  fireEvent.pointerUp(content, { clientX: to, clientY: 0, pointerId: 1 });
}

beforeEach(async () => {
  resetStore();
  useNavStore.setState({ byRepo: {} });
  useComposerStore.getState().reset();
  useAiStore.getState().reset();
  vi.clearAllMocks();
  backend = await installBackend();
  backend.status.mockImplementation(() => ok(dirty()));
});

afterEach(() => resetViewport());

describe("Changes screen (390x844)", () => {
  it("shows two sections with 52px rows and a checkbox that toggles staging", async () => {
    const user = await openChanges();
    const staged = screen.getByTestId("section-staged");
    const unstaged = screen.getByTestId("section-unstaged");
    expect(within(staged).getAllByRole("button", { name: /^Open / })).toHaveLength(1);
    expect(within(unstaged).getAllByRole("button", { name: /^Open / })).toHaveLength(2);
    const row = screen.getByRole("button", { name: "Open src/a.ts" });
    expect(row.className).toContain("min-h-[var(--touch-target-row)]");

    await user.click(screen.getByRole("checkbox", { name: "Stage src/a.ts" }));
    await waitFor(() => expect(backend.stagePaths).toHaveBeenCalledWith("r1", ["src/a.ts"]));
    await user.click(screen.getByRole("checkbox", { name: "Unstage src/b.ts" }));
    await waitFor(() => expect(backend.unstagePaths).toHaveBeenCalledWith("r1", ["src/b.ts"]));
    await user.click(screen.getByRole("button", { name: "Stage all" }));
    await waitFor(() =>
      expect(backend.stagePaths).toHaveBeenCalledWith("r1", ["src/a.ts", "README.md"]),
    );
  });

  it("stages with a right swipe and unstages with a left swipe", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 52,
      top: 0,
      left: 0,
      right: 300,
      bottom: 52,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await openChanges();
    swipe("src/a.ts", 0, 200);
    await waitFor(() => expect(backend.stagePaths).toHaveBeenCalledWith("r1", ["src/a.ts"]));
    swipe("src/b.ts", 250, 20);
    await waitFor(() => expect(backend.unstagePaths).toHaveBeenCalledWith("r1", ["src/b.ts"]));
    rect.mockRestore();
  });

  it("opens a unified-only diff page and stages a hunk like desktop", async () => {
    const user = await openChanges();
    await user.click(screen.getByRole("button", { name: "Open src/a.ts" }));
    expect(useNavStore.getState().byRepo["r1"]?.stack).toEqual([
      { name: "worktreeDiff", path: "src/a.ts", staged: false },
    ]);
    await screen.findAllByTestId("diff-hunk");
    expect(screen.queryByRole("tab", { name: "Split" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-line-old-num]")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Stage hunk" })[1]!);
    await waitFor(() =>
      expect(backend.stageLines).toHaveBeenCalledWith("r1", {
        path: "src/a.ts",
        options: { contextLines: 3, ignoreWhitespace: false },
        hunks: [{ hunkIndex: 1, lines: null }],
      }),
    );
  });
});

describe("Composer (390x844)", () => {
  it("disables Commit until there is a summary, counts to 72 and keeps the draft", async () => {
    const user = await openChanges();
    push({ name: "compose" });
    const commit = await screen.findByRole("button", { name: "Commit" });
    expect(commit).toBeDisabled();
    const summary = screen.getByLabelText("Summary");
    await user.type(summary, "Add thing");
    expect(screen.getByTestId("summary-count")).toHaveTextContent("9/72");
    expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled();

    act(() => void useNavStore.getState().pop("r1"));
    expect(await screen.findByRole("button", { name: "Commit message" })).toHaveTextContent(
      "Add thing",
    );
    push({ name: "compose" });
    expect(await screen.findByLabelText("Summary")).toHaveValue("Add thing");

    await user.clear(screen.getByLabelText("Summary"));
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "x".repeat(80) } });
    expect(screen.getByTestId("summary-count")).toHaveAttribute("data-over", "true");
  });

  it("pre-fills the last message on amend", async () => {
    const user = await openChanges();
    push({ name: "compose" });
    await user.click(await screen.findByRole("switch", { name: "Amend" }));
    await waitFor(() => expect(screen.getByLabelText("Summary")).toHaveValue("Details for 0"));
    expect(screen.getByLabelText("Description")).toHaveValue("Body text");
  });

  it("asks for a git identity before the first commit on Android", async () => {
    backend.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
    backend.gitIdentityGet.mockImplementation(() => ok({ name: null, email: null }));
    const user = await openChanges();
    act(() => useComposerStore.getState().update("r1", { summary: "First" }));
    await waitFor(() => expect(backend.platformInfo).toHaveBeenCalled());
    await user.click(await screen.findByRole("button", { name: /^Commit\s*1$/ }));
    const sheet = await screen.findByRole("dialog", { name: "Who are you?" });
    const email = within(sheet).getByLabelText("Email");
    expect(email).toHaveAttribute("autocapitalize", "none");
    await user.type(within(sheet).getByLabelText("Name"), "Ada");
    await user.type(email, "ada@example.com");
    await user.click(within(sheet).getByRole("button", { name: "Save and commit" }));
    await waitFor(() =>
      expect(backend.gitIdentitySet).toHaveBeenCalledWith("Ada", "ada@example.com"),
    );
    await waitFor(() =>
      expect(backend.commitCreate).toHaveBeenCalledWith("r1", {
        message: "First",
        amend: false,
        signOff: false,
        allowEmpty: false,
      }),
    );
  });

  it("does not ask for an identity on desktop platforms", async () => {
    backend.gitIdentityGet.mockImplementation(() => ok({ name: null, email: null }));
    const user = await openChanges();
    act(() => useComposerStore.getState().update("r1", { summary: "First" }));
    await user.click(await screen.findByRole("button", { name: /^Commit\s*1$/ }));
    await waitFor(() => expect(backend.commitCreate).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "Who are you?" })).not.toBeInTheDocument();
  });
});

describe("AI dialogs", () => {
  it("render as a sheet on compact layouts", async () => {
    await openApp();
    await screen.findByRole("navigation", { name: "Primary" });
    act(() => openAskAi("r1"));
    const dialog = await screen.findByRole("dialog", { name: "Ask AI" });
    expect(dialog).toHaveAttribute("data-snap", "full");
  });

  it("stay a centered dialog on desktop", async () => {
    await openApp(1280, 800);
    await screen.findByRole("grid", { name: "Commit graph" });
    act(() => openAskAi("r1"));
    const dialog = await screen.findByRole("dialog", { name: "Ask AI" });
    expect(dialog).not.toHaveAttribute("data-snap");
  });
});
