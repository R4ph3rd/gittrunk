import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandHost } from "@/app/commands/CommandHost";
import { useCommandStore } from "@/app/commands";
import { fail } from "@/app/mockBindings";
import { installDomShims } from "@/app/testing";
import { TooltipProvider } from "@/design/components";
import { ThemeProvider } from "@/design/theme";
import { commands } from "@/ipc/bindings";
import { useAiStore } from "@/stores/ai";
import { AiCommitMessageButton, AiHost, suggestConflictResolution } from "./index";
import { installAiBackend, type AiCommands } from "./testing";

vi.mock("@/ipc/bindings", async () => (await import("./testing")).aiBindingsMock());
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();
Element.prototype.scrollIntoView ??= () => {};

const mocks = () => commands as unknown as AiCommands;

function setup(initial: Parameters<typeof installAiBackend>[1] = {}, onResult = vi.fn()) {
  installAiBackend(commands as unknown as Record<string, unknown>, initial);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>
          <CommandHost />
          <AiHost />
          <AiCommitMessageButton repoId="r1" onResult={onResult} />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onResult, user: userEvent.setup() };
}

const runCommand = (id: string, repoId: string | null = "r1") =>
  act(async () => {
    await useCommandStore.getState().commands[id]!.run({
      repoId,
      queryClient: new QueryClient(),
      platform: "other",
      openPalette: () => {},
      openShortcutsHelp: () => {},
    });
  });

beforeEach(() => {
  vi.clearAllMocks();
  useAiStore.getState().reset();
});

describe("AI settings dialog", () => {
  it("registers the ai.settings command and shows the privacy note", async () => {
    setup();
    expect(useCommandStore.getState().commands["ai.settings"]?.title).toBe("AI settings");
    await runCommand("ai.settings");
    expect(await screen.findByText(/only when you use an AI action/)).toHaveTextContent(
      "Repository content is sent to Anthropic only when you use an AI action.",
    );
  });

  it("saves the enable switch and settings", async () => {
    const { user } = setup({ enabled: false });
    await runCommand("ai.settings");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("switch"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks().aiSettingsSet).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, provider: "anthropic", maxDiffBytes: 60_000 }),
      ),
    );
  });

  it("stores a key without ever displaying it, then clears it", async () => {
    const { user } = setup();
    await runCommand("ai.settings");
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("API key");
    expect(input).toHaveAttribute("type", "password");
    await user.type(input, "sk-very-secret");
    await user.click(within(dialog).getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(mocks().aiKeySet).toHaveBeenCalledWith("anthropic", "sk-very-secret"),
    );
    expect(await within(dialog).findByText("Key stored")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sk-very-secret");
    expect(screen.queryByDisplayValue("sk-very-secret")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(mocks().aiKeyClear).toHaveBeenCalledWith("anthropic"));
    expect(await within(dialog).findByLabelText("API key")).toBeInTheDocument();
  });

  it("shows the base URL only for OpenAI-compatible providers", async () => {
    const { user } = setup();
    await runCommand("ai.settings");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Base URL")).toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: "OpenAI-compatible" }));
    expect(await within(dialog).findByLabelText("Base URL")).toBeInTheDocument();
    expect(mocks().aiSettingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openAiCompatible", model: "gpt-4o-mini" }),
    );
  });
});

describe("commit message button", () => {
  it("previews the payload first, sends on confirm, then skips the preview", async () => {
    const { user, onResult } = setup();
    const button = screen.getByRole("button", { name: "Generate commit message with AI" });
    await user.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Staged changes: \+hello/)).toBeInTheDocument();
    expect(mocks().aiRun).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("feat: add hello"));
    expect(mocks().aiRun).toHaveBeenCalledWith("r1", { kind: "commitMessage" });

    await user.click(button);
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    expect(mocks().aiPayloadPreview).toHaveBeenCalledTimes(1);
  });

  it("does not send when cancelled", async () => {
    const { user, onResult } = setup();
    await user.click(screen.getByRole("button", { name: "Generate commit message with AI" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocks().aiRun).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("offers AI settings when AI is disabled", async () => {
    const { user } = setup();
    mocks().aiPayloadPreview.mockImplementation(() =>
      fail("aiDisabled", "AI assistance is turned off."),
    );
    await user.click(screen.getByRole("button", { name: "Generate commit message with AI" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "AI assistance is turned off.",
        expect.objectContaining({ action: expect.objectContaining({ label: "AI settings" }) }),
      ),
    );
  });
});

describe("conflict suggestion", () => {
  it("returns the model text", async () => {
    setup();
    await expect(suggestConflictResolution("r1", "a.txt")).resolves.toBe("feat: add hello");
    expect(mocks().aiRun).toHaveBeenCalledWith("r1", {
      kind: "conflictSuggestion",
      path: "a.txt",
    });
  });
});

describe("Ask AI", () => {
  it("only applies with an open repository and has the shortcut", () => {
    setup();
    const cmd = useCommandStore.getState().commands["ai.ask"]!;
    expect(cmd.shortcut).toBe("mod+shift+i");
  });

  it("shows disabled state with a button to open AI settings", async () => {
    const { user } = setup();
    mocks().aiPayloadPreview.mockImplementation(() =>
      fail("aiDisabled", "AI assistance is turned off."),
    );
    await runCommand("ai.ask");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("What do you want to do?"), "do a thing");
    await user.click(within(dialog).getByRole("button", { name: "Preview request" }));
    await user.click(await within(dialog).findByRole("button", { name: "Open AI settings" }));
    expect(useAiStore.getState().settingsOpen).toBe(true);
  });

  it("renders the plan and executes only after confirmation, with undo", async () => {
    const { user } = setup();
    await runCommand("ai.ask");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("What do you want to do?"), "make a branch");
    await user.click(within(dialog).getByRole("button", { name: "Preview request" }));
    expect(await within(dialog).findByText(/Staged changes/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Send" }));

    expect(await within(dialog).findByText("Creates the branch and switches to it.")).toBeVisible();
    const steps = within(within(dialog).getByRole("list", { name: "Plan steps" })).getAllByRole(
      "listitem",
    );
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent("Create branch topic");
    expect(within(dialog).getByText("2 steps: create topic; merge feature")).toBeInTheDocument();
    expect(within(dialog).getByText(/changes the repository in 2 steps/)).toBeInTheDocument();
    expect(mocks().aiPlanExecute).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Run plan" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(mocks().aiPlanExecute).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Run plan" }));
    await waitFor(() => expect(mocks().aiPlanExecute).toHaveBeenCalledWith("r1", "plan-1"));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Ran 2 steps.",
        expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
      ),
    );
    const opts = vi.mocked(toast.success).mock.calls[0]![1] as unknown as {
      action: { onClick: () => void };
    };
    opts.action.onClick();
    await waitFor(() => expect(mocks().undo).toHaveBeenCalledWith("r1", false));
  });
});
