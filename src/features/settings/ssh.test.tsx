import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandHost } from "@/app/commands/CommandHost";
import { useCommandStore } from "@/app/commands";
import { fail, ok } from "@/app/mockBindings";
import { ANDROID_PLATFORM, DESKTOP_PLATFORM } from "@/app/platform";
import { installDomShims } from "@/app/testing";
import { TooltipProvider } from "@/design/components";
import { ThemeProvider } from "@/design/theme";
import { commands } from "@/ipc/bindings";
import type { SshKey, SshKeyList } from "@/ipc/bindings";
import { useSettingsStore } from "@/stores/settings";
import { SettingsHost } from "./SettingsHost";
import { SshKeysSection } from "./SshKeysSection";
import { installSettingsBackend } from "./testing";

vi.mock("@/ipc/bindings", async () => (await import("./testing")).settingsBindingsMock());
vi.mock("sonner", async () => (await import("@/app/mockBindings")).sonnerMock());

installDomShims();
Element.prototype.scrollIntoView ??= () => {};

type Fn = ReturnType<typeof vi.fn>;
const c = commands as unknown as Record<
  "sshKeysList" | "sshKeyGenerate" | "appOpenUrl" | "platformInfo" | "gitIdentityGet",
  Fn
>;

const key = (name: string, parts: Partial<SshKey> = {}): SshKey => ({
  name,
  path: `/home/test/.ssh/${name}`,
  publicKey: `ssh-ed25519 AAAA${name} ada@example.com`,
  algorithm: "ssh-ed25519",
  fingerprint: `SHA256:fp-${name}`,
  comment: "ada@example.com",
  hasPrivateKey: true,
  ...parts,
});

let list: SshKeyList;

function setup(keys: SshKey[] = [], platform = DESKTOP_PLATFORM) {
  installSettingsBackend(commands as unknown as Record<string, unknown>);
  list = { dir: "/home/test/.ssh", keys };
  c.sshKeysList.mockImplementation(() => ok(list));
  c.appOpenUrl.mockImplementation(() => ok(null));
  c.platformInfo.mockImplementation(() => ok(platform));
  c.gitIdentityGet.mockImplementation(() => ok({ name: "Ada", email: "ada@example.com" }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>
          <CommandHost />
          <SettingsHost />
          <SshKeysSection />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useCommandStore.setState({ commands: {}, paletteOpen: false, helpOpen: false, recent: [] });
  useSettingsStore.setState({ settings: null, overrides: {}, open: false, section: "general" });
});

describe("SSH keys section", () => {
  it("is hidden from the settings dialog on Android", async () => {
    const user = userEvent.setup();
    setup([], ANDROID_PLATFORM);
    await user.keyboard("{Control>},{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() =>
      expect(within(dialog).queryByRole("button", { name: "SSH keys" })).not.toBeInTheDocument(),
    );
  });

  it("is listed in the settings dialog on desktop and opens", async () => {
    const user = userEvent.setup();
    setup([key("id_ed25519")]);
    await user.keyboard("{Control>},{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await user.click(await within(dialog).findByRole("button", { name: "SSH keys" }));
    expect(await within(dialog).findByRole("form", { name: "Generate SSH key" })).toBeVisible();
  });

  it("lists keys with fingerprint and flags a missing private key", async () => {
    setup([key("id_ed25519"), key("deploy", { hasPrivateKey: false })]);
    expect(await screen.findByText("/home/test/.ssh")).toBeInTheDocument();
    expect(screen.getByText("SHA256:fp-id_ed25519")).toBeInTheDocument();
    expect(screen.getByText("SHA256:fp-deploy")).toBeInTheDocument();
    expect(screen.getAllByText("Public key only")).toHaveLength(1);
  });

  it("copies the public key and opens the GitHub page", async () => {
    const user = userEvent.setup();
    setup([key("id_ed25519")]);
    // user-event installs its own clipboard stub: spy on it after setup().
    const write = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(await screen.findByRole("button", { name: "Copy public key" }));
    expect(write).toHaveBeenCalledWith("ssh-ed25519 AAAAid_ed25519 ada@example.com");
    expect(toast.success).toHaveBeenCalledWith("Public key copied");
    await user.click(screen.getByRole("button", { name: "Add to GitHub" }));
    expect(c.appOpenUrl).toHaveBeenCalledWith("https://github.com/settings/ssh/new");
    await user.click(screen.getByRole("button", { name: "Add to GitLab" }));
    expect(c.appOpenUrl).toHaveBeenCalledWith("https://gitlab.com/-/user_settings/ssh_keys");
  });

  it("proposes another name when id_ed25519 exists", async () => {
    setup([key("id_ed25519")]);
    expect(await screen.findByLabelText("Name")).toHaveValue("id_ed25519_gittrunk");
  });

  it("validates the name and the passphrase confirmation", async () => {
    const user = userEvent.setup();
    setup([key("id_ed25519")]);
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "id_ed25519");
    await user.click(screen.getByRole("button", { name: "Generate key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    await user.clear(name);
    await user.type(name, "bad name");
    await user.click(screen.getByRole("button", { name: "Generate key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use letters");
    await user.clear(name);
    await user.type(name, "work");
    await user.type(screen.getByLabelText("Passphrase"), "one");
    await user.type(screen.getByLabelText("Confirm passphrase"), "two");
    await user.click(screen.getByRole("button", { name: "Generate key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("do not match");
    expect(c.sshKeyGenerate).not.toHaveBeenCalled();
  });

  it("generates a key without a passphrase and shows it", async () => {
    const user = userEvent.setup();
    setup();
    c.sshKeyGenerate.mockImplementation((req: { name: string }) => {
      const created = key(req.name);
      list = { ...list, keys: [created] };
      return ok(created);
    });
    expect(await screen.findByText("No SSH keys yet")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Comment")).toHaveValue("ada@example.com"));
    await user.click(screen.getByRole("button", { name: "Generate key" }));
    await waitFor(() =>
      expect(c.sshKeyGenerate).toHaveBeenCalledWith({
        name: "id_ed25519",
        comment: "ada@example.com",
        passphrase: null,
      }),
    );
    expect(await screen.findByText("SHA256:fp-id_ed25519")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Created id_ed25519");
  });

  it("sends the passphrase, clears it afterwards and never toasts it", async () => {
    const user = userEvent.setup();
    setup([key("id_ed25519")]);
    c.sshKeyGenerate.mockImplementation((req: { name: string }) => ok(key(req.name)));
    await user.type(await screen.findByLabelText("Passphrase"), "s3cret");
    await waitFor(() => expect(screen.getByLabelText("Comment")).toHaveValue("ada@example.com"));
    await user.type(screen.getByLabelText("Confirm passphrase"), "s3cret");
    expect(screen.getByLabelText("Passphrase")).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Generate key" }));
    await waitFor(() =>
      expect(c.sshKeyGenerate).toHaveBeenCalledWith({
        name: "id_ed25519_gittrunk",
        comment: "ada@example.com",
        passphrase: "s3cret",
      }),
    );
    await waitFor(() => expect(screen.getByLabelText("Passphrase")).toHaveValue(""));
    expect(screen.getByLabelText("Confirm passphrase")).toHaveValue("");
    expect(JSON.stringify((toast.success as Fn).mock.calls)).not.toContain("s3cret");
  });

  it("keeps a backend error inline", async () => {
    const user = userEvent.setup();
    setup();
    c.sshKeyGenerate.mockImplementation(() => fail("io", "Cannot write ~/.ssh"));
    await user.click(await screen.findByRole("button", { name: "Generate key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot write ~/.ssh");
  });
});
