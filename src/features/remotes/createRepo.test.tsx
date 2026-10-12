import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBackend, installDomShims, ok, renderApp, resetStore } from "@/app/testing";
import { fail } from "@/app/mockBindings";
import { ANDROID_PLATFORM } from "@/app/platform";
import type { ForgeTokenSource } from "@/ipc/bindings";
import { renderWithClient } from "@/features/forge/testing";
import { openSettings } from "@/stores/settings";
import { RemoteFormDialog } from "./RemoteFormDialog";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve("/work")) }));
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());
vi.mock("@/stores/settings", async (orig) => ({
  ...(await orig<typeof import("@/stores/settings")>()),
  openSettings: vi.fn(),
}));

installDomShims();
Element.prototype.scrollIntoView ??= () => {};

const CREATED = {
  cloneUrl: "https://github.com/alice/demo.git",
  sshUrl: "git@github.com:alice/demo.git",
  htmlUrl: "https://github.com/alice/demo",
};

async function setup(
  opts: { token?: ForgeTokenSource; exists?: boolean; readOnly?: boolean } = {},
) {
  const commands = await installBackend();
  commands.refsList.mockImplementation(() =>
    ok({
      head: { kind: "branch", name: "main", oid: "0".repeat(40) },
      local: [
        {
          name: "main",
          fullName: "refs/heads/main",
          oid: "0".repeat(40),
          upstream: null,
          upstreamGone: false,
          ahead: 0,
          behind: 0,
          isHead: true,
          remote: null,
        },
      ],
      remote: [],
      tags: [],
      stashes: [],
    }),
  );
  commands.forgeTokenSource.mockImplementation(() => ok(opts.token ?? "forge"));
  commands.forgeOwners.mockImplementation(() =>
    ok([
      { login: "alice", kind: "user" },
      { login: "acme", kind: "org" },
    ]),
  );
  commands.forgeRepoExists.mockImplementation(() => ok(opts.exists ?? true));
  commands.forgeCreateRepo.mockImplementation(() => ok(CREATED));
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderApp();
  await user.click(await screen.findByRole("button", { name: /demo/ }));
  await screen.findByRole("toolbar", { name: "Remote operations" });
  await user.click(screen.getByRole("button", { name: "Add remote" }));
  const dialog = await screen.findByRole("dialog", { name: "Add remote" });
  return { commands, user, dialog };
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe("add remote: create a repository", () => {
  it("offers both modes and creates, adds the remote and pushes with upstream", async () => {
    const { commands, user, dialog } = await setup({ token: "forge" });
    await user.click(within(dialog).getByRole("radio", { name: "Create new on GitHub" }));

    expect(within(dialog).getByLabelText("Repository name")).toHaveValue("demo");
    // The fixture repo already has an origin, so the new remote defaults to "github".
    expect(within(dialog).getByLabelText("Remote name")).toHaveValue("github");
    expect(within(dialog).getByRole("radio", { name: "Private" })).toBeChecked();
    await waitFor(() => expect(within(dialog).getByLabelText("Owner")).toHaveValue("alice"));

    await user.type(within(dialog).getByLabelText("Description (optional)"), "My demo");
    await user.click(within(dialog).getByRole("button", { name: "Create repository" }));

    await waitFor(() =>
      expect(commands.forgeCreateRepo).toHaveBeenCalledWith("github.com", {
        owner: "alice",
        name: "demo",
        description: "My demo",
        private: true,
      }),
    );
    await waitFor(() =>
      expect(commands.remoteAdd).toHaveBeenCalledWith("r1", {
        name: "github",
        url: CREATED.cloneUrl,
        fetch: false,
      }),
    );
    await waitFor(() =>
      expect(commands.push).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ remote: "github", setUpstream: true }),
      ),
    );
  });

  it("uses the ssh url and skips the push when unchecked", async () => {
    const { commands, user, dialog } = await setup();
    await user.click(within(dialog).getByRole("radio", { name: "Create new on GitHub" }));
    await user.click(within(dialog).getByRole("radio", { name: "SSH" }));
    await user.click(within(dialog).getByRole("radio", { name: "Public" }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Push .* and set upstream/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create repository" }));
    await waitFor(() =>
      expect(commands.remoteAdd).toHaveBeenCalledWith("r1", {
        name: "github",
        url: CREATED.sshUrl,
        fetch: false,
      }),
    );
    expect(commands.forgeCreateRepo).toHaveBeenCalledWith(
      "github.com",
      expect.objectContaining({ private: false }),
    );
    expect(commands.push).not.toHaveBeenCalled();
  });

  it("offers to just add the repository when the name is taken", async () => {
    const { commands, user, dialog } = await setup();
    commands.forgeCreateRepo.mockImplementation(() =>
      fail("invalidInput", "A repository named demo already exists in alice", "already_exists"),
    );
    await user.click(within(dialog).getByRole("radio", { name: "Create new on GitHub" }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Push .* and set upstream/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create repository" }));
    expect(await within(dialog).findByText(/already exists in alice/)).toBeInTheDocument();
    expect(commands.remoteAdd).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: "Add the existing repository as a remote" }),
    );
    await waitFor(() =>
      expect(commands.remoteAdd).toHaveBeenCalledWith("r1", {
        name: "github",
        url: "https://github.com/alice/demo.git",
        fetch: false,
      }),
    );
    expect(commands.forgeCreateRepo).toHaveBeenCalledTimes(1);
  });

  it("shows scope guidance returned by the backend", async () => {
    const { commands, user, dialog } = await setup();
    commands.forgeCreateRepo.mockImplementation(() =>
      fail("authRequired", "The token cannot create repositories. Use the `repo` scope"),
    );
    await user.click(within(dialog).getByRole("radio", { name: "Create new on GitHub" }));
    await user.click(within(dialog).getByRole("button", { name: "Create repository" }));
    expect(await within(dialog).findByText(/`repo` scope/)).toBeInTheDocument();
    expect(commands.remoteAdd).not.toHaveBeenCalled();
  });

  it("without a token points to Settings > Integrations", async () => {
    const { commands, user, dialog } = await setup({ token: "none" });
    await user.click(within(dialog).getByRole("radio", { name: "Create new on GitHub" }));
    expect(within(dialog).getByText(/needs a GitHub token/)).toBeInTheDocument();
    expect(within(dialog).getByText("repo")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Create repository" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: /Open Settings/ }));
    expect(openSettings).toHaveBeenCalledWith("integrations");
    expect(commands.forgeCreateRepo).not.toHaveBeenCalled();
  });

  it("is hidden on read-only platforms", async () => {
    const commands = await installBackend();
    commands.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM));
    renderWithClient(<RemoteFormDialog repoId="r1" mode={{ kind: "add" }} onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog", { name: "Add remote" });
    await waitFor(() => expect(commands.platformInfo).toHaveBeenCalled());
    expect(within(dialog).queryByRole("radio", { name: "Create new on GitHub" })).toBeNull();
    expect(within(dialog).getByLabelText("URL")).toBeInTheDocument();
  });
});

describe("add remote: existing URL", () => {
  it("prompts to create a github repository that does not exist", async () => {
    const { commands, user, dialog } = await setup({ exists: false });
    await user.type(within(dialog).getByLabelText("URL"), "https://github.com/acme/newthing.git");
    expect(
      await within(dialog).findByText("This repository doesn't exist on GitHub. Create it?"),
    ).toBeInTheDocument();
    expect(commands.forgeRepoExists).toHaveBeenCalledWith("github.com", "acme", "newthing");

    await user.click(within(dialog).getByRole("button", { name: "Create acme/newthing" }));
    expect(within(dialog).getByLabelText("Repository name")).toHaveValue("newthing");
    await waitFor(() => expect(within(dialog).getByLabelText("Owner")).toHaveValue("acme"));
  });

  it("adds the remote without validation when the repository is missing", async () => {
    const { commands, user, dialog } = await setup({ exists: false });
    await user.type(within(dialog).getByLabelText("Name"), "origin");
    await user.type(within(dialog).getByLabelText("URL"), "https://github.com/acme/newthing.git");
    await within(dialog).findByText(/doesn't exist on GitHub/);
    await user.click(within(dialog).getByRole("button", { name: "Add remote" }));
    await waitFor(() => expect(commands.remoteAdd).toHaveBeenCalled());
    expect(commands.fetch).not.toHaveBeenCalled();
  });

  it("does not prompt when the repository exists", async () => {
    const { commands, user, dialog } = await setup({ exists: true });
    await user.type(within(dialog).getByLabelText("URL"), "https://github.com/acme/real.git");
    await waitFor(() => expect(commands.forgeRepoExists).toHaveBeenCalled());
    expect(within(dialog).queryByText(/doesn't exist on GitHub/)).toBeNull();
  });

  it("does not check or prompt without a token, and hints at Settings", async () => {
    const { commands, user, dialog } = await setup({ token: "none", exists: false });
    await user.type(within(dialog).getByLabelText("URL"), "https://github.com/acme/newthing.git");
    expect(await within(dialog).findByText(/Add a GitHub token/)).toBeInTheDocument();
    expect(commands.forgeRepoExists).not.toHaveBeenCalled();
  });

  it("notes that creation is GitHub-only for other hosts and still adds", async () => {
    const { commands, user, dialog } = await setup();
    await user.type(within(dialog).getByLabelText("Name"), "origin");
    await user.type(within(dialog).getByLabelText("URL"), "https://gitlab.com/g/p.git");
    expect(await within(dialog).findByText(/GitHub-only for now/)).toBeInTheDocument();
    expect(commands.forgeRepoExists).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Add remote" }));
    await waitFor(() =>
      expect(commands.remoteAdd).toHaveBeenCalledWith("r1", {
        name: "origin",
        url: "https://gitlab.com/g/p.git",
        fetch: false,
      }),
    );
  });
});
