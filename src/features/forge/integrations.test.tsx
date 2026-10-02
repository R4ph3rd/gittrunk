import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/app/mockBindings";
import { installDomShims } from "@/app/testing";
import { commands } from "@/ipc/bindings";
import { installSettingsBackend } from "@/features/settings/testing";
import { useSettingsStore } from "@/stores/settings";
import { Integrations } from "./Integrations";
import { forgeReady, renderWithClient } from "./testing";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();

const c = commands as unknown as ReturnType<typeof forgeReady> &
  ReturnType<typeof installSettingsBackend>;

beforeEach(() => {
  vi.clearAllMocks();
  installSettingsBackend(commands as unknown as Record<string, unknown>);
  useSettingsStore.setState({ settings: null });
});

describe("Integrations", () => {
  it.each([
    ["forge", "Token saved"],
    ["gitCredential", "Using the HTTPS credential saved for github.com"],
    ["none", "No token: public repositories only, read-only"],
  ] as const)("shows the status for %s", async (source, text) => {
    forgeReady(commands, { token: source });
    renderWithClient(<Integrations />);
    expect(await screen.findByText(text)).toBeInTheDocument();
    // Remove only exists for a token saved in gittrunk.
    expect(!!screen.queryByRole("button", { name: "Remove" })).toBe(source === "forge");
  });

  it("saves a token, reports the user and clears the field", async () => {
    forgeReady(commands, { token: "none" });
    c.forgeTokenSet.mockImplementation(() => ok({ login: "ada" }));
    const user = userEvent.setup();
    renderWithClient(<Integrations />);
    const field = await screen.findByLabelText("Personal access token");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, "ghp_secret");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Connected as @ada")).toBeInTheDocument();
    expect(c.forgeTokenSet).toHaveBeenCalledWith("github.com", "ghp_secret");
    expect(field).toHaveValue("");
  });

  it("shows a failed save inline", async () => {
    forgeReady(commands, { token: "none" });
    c.forgeTokenSet.mockImplementation(() => fail("authFailed", "Bad credentials"));
    const user = userEvent.setup();
    renderWithClient(<Integrations />);
    await user.type(await screen.findByLabelText("Personal access token"), "nope");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bad credentials");
  });

  it("removes a saved token", async () => {
    forgeReady(commands, { token: "forge" });
    c.forgeTokenClear.mockImplementation(() => ok(null));
    const user = userEvent.setup();
    renderWithClient(<Integrations />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(c.forgeTokenClear).toHaveBeenCalledWith("github.com"));
  });

  it("updates the avatar mode and invalidates avatar queries", async () => {
    forgeReady(commands);
    const user = userEvent.setup();
    const { client } = renderWithClient(<Integrations />);
    client.setQueryData(["avatar", "email:a@b.c", 64], "data:image/png;base64,AA");
    const spy = vi.spyOn(client, "invalidateQueries");
    expect(screen.getByRole("radio", { name: "GitHub only" })).toBeChecked();
    expect(screen.getByText(/Gravatar receives a hash/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "GitHub and Gravatar" }));
    await waitFor(() =>
      expect(c.settingsSet).toHaveBeenCalledWith(
        expect.objectContaining({ avatars: "githubAndGravatar" }),
      ),
    );
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["avatar"] })),
    );
  });

  it("shows GitLab and Bitbucket cards as coming soon without any input", async () => {
    forgeReady(commands, { token: "none" });
    renderWithClient(<Integrations />);
    for (const title of ["GitLab", "Bitbucket and Gitea"]) {
      const card = (await screen.findByRole("heading", { name: title })).closest("section")!;
      expect(within(card).getByText("Coming soon")).toBeInTheDocument();
      expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
      expect(within(card).queryByLabelText(/token/i)).not.toBeInTheDocument();
      expect(within(card).queryByRole("button")).not.toBeInTheDocument();
      expect(card).toHaveTextContent(`Repositories on ${title}`);
    }
  });

  it("orders GitHub, GitLab, Bitbucket and Gitea, then Avatars", async () => {
    forgeReady(commands, { token: "none" });
    renderWithClient(<Integrations />);
    await screen.findByText("No token: public repositories only, read-only");
    const names = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(["GitHub", "GitLab", "Bitbucket and Gitea"]);
    expect(screen.getByText("Avatars")).toBeInTheDocument();
  });

  it("explains the token scopes", async () => {
    forgeReady(commands, { token: "none" });
    renderWithClient(<Integrations />);
    expect(await screen.findByText(/plus the notifications scope/)).toBeInTheDocument();
  });
});
