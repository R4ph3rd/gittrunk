# UI-TOPRIGHT: notifications popover and Settings (SSH keys, integrations, backdrop switch)

- Wave: 1 (after C10 is merged; parallel with B10, UI-START, UI-PULLS, UI-BACKDROP)
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/settings-m10-topright`
- Read first: `docs/PLAN.md` §13 (item 5, "SSH keys", "Integrations", "Notifications"); `src/design/components/Toaster.tsx`; `src/stores/notifications.ts`; `src/features/settings/{SettingsDialog.tsx,SettingsPage.tsx,settings.test.tsx}`; `src/features/forge/{Integrations.tsx,integrations.test.tsx,gate.ts}`; stub `src/features/notifications/NotificationsButton.tsx`.
- Frontend only: never run cargo, `pnpm bindings` or `pnpm tauri`.

## Goal

1. A **Notifications** button (bell with unread badge) whose popover lists recent app events (every toast: fetch/pull/push results, operation errors, …) and, when a GitHub token exists, unread GitHub notifications.
2. **Settings** gains an **SSH keys** section (list `~/.ssh` keys, copy public key, generate an ed25519 key, open the GitHub/GitLab SSH key pages) and a reworked **Integrations** section (GitHub card with scope guidance; GitLab and Bitbucket/Gitea cards marked "Coming soon"), plus a **Background gradients** switch in General.

UI-START mounts `<NotificationsButton />` and the Settings gear in the tab strip; you implement what they open.

## Rules (every M10 brief)

- Repo `/home/user/gittrunk`, integration branch `claude/relaxed-allen-0mjwae`. Worktree: `git -C /home/user/gittrunk worktree add /home/user/wt-settings-m10-topright -b feat/settings-m10-topright claude/relaxed-allen-0mjwae`; work only there with absolute paths; `pnpm install --frozen-lockfile` once.
- Touch only "Owned files". Need a hook, type, store field, token or dependency? Do not edit it: list it under "Needs orchestrator" and work around locally.
- Styling: tokens only; no hex/rgb, no Tailwind palette classes. lucide-react icons; icon-only buttons have `aria-label` + `Tooltip`; keyboard reachable; the popover is a Radix popover (focus managed, `Esc` closes).
- **Untrusted text**: GitHub notification titles and repository names render as plain React text.
- **Secrets**: the passphrase field is `type="password"`, `autoComplete="new-password"`, cleared after generation and never logged or put in a toast. Private keys never reach the UI (the backend only returns public keys).
- Capabilities: `usePlatform().supportsSsh` gates the SSH section (false on Android); layout from `useLayout()` decides dialog vs page.
- Tests: Vitest + Testing Library with mocked bindings (`bindingsMock()`, `sonnerMock()`), `installBackend()`, `resetStore()`, `renderApp()` from `src/app/testing.tsx`; settings helpers in `src/features/settings/testing.ts`; forge helpers in `src/features/forge/testing.ts`. Whole suite green; foreign test assertions you break are adapted in a separate `test(<scope>)` commit and listed.
- Commits: Conventional Commits with a scope, made with
  `git -c user.name=Claude -c user.email=noreply@anthropic.com commit --author="R4ph3rd <43202876+R4ph3rd@users.noreply.github.com>" -F - <<'EOF' ... EOF`; every message ends with a blank line and exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FzHMmoKCskK5U6Gdp6AZmv
  ```
  Do not push, rebase or merge.
- Report back: branch and hashes; every gate with exit code; acceptance one line each; deviations; "Needs orchestrator"; foreign tests adapted; anything visual you could not verify.

## Owned files

Modify: `src/design/components/Toaster.tsx` (the `toast` export only), `src/features/notifications/NotificationsButton.tsx` (replace the stub; keep name, no props), `src/features/settings/{SettingsDialog.tsx,SettingsPage.tsx}`, `src/features/forge/Integrations.tsx`, `src/features/settings/settings.test.tsx` (primary owner in M10), `src/features/forge/integrations.test.tsx`.
Create: `src/features/notifications/{NotificationsPopover.tsx,notifications.test.tsx}`, `src/features/settings/{SshKeysSection.tsx,ssh.test.tsx}`, `src/design/components/toaster.test.ts`.
Must NOT touch: `src/stores/**`, `src/ipc/**`, other `src/design/**` files, `src/features/repo/RepoTabs.tsx` (UI-START mounts your button), `src/features/forge/{parts.tsx,gate.ts,helpers.ts}` and the issue/pull files, `src/features/home/**`.

## Contracts you use (merged by C10; read the real files)

- `useNotificationsStore` (`src/stores/notifications.ts`): `items: AppNotification[] { id, level: "success"|"error"|"warning"|"info", title, detail, at, source, read }` (newest first, max 50), `push({ level, title, detail? })`, `markAllRead()`, `clear()`, `reset()`; `useUnreadNotifications()`.
- Queries (`src/ipc/queries.ts`): `useForgeNotifications(host, { enabled })` → `ForgeNotification[] { id, title, kind, reason, repo, unread, updatedAt, url }`; `useForgeTokenSource(host)` (`"forge" | "gitCredential" | "none"`); `useSshKeys(enabled?)` → `SshKeyList { dir, keys: SshKey[] { name, path, publicKey, algorithm, fingerprint, comment, hasPrivateKey } }`; `useGenerateSshKey()` (mutation, arg `{ name, comment, passphrase }`); `useGitIdentity()` (`{ name, email }`); `openUrl(url)`; `isIpcError(e)` (`src/ipc/client.ts`).
- Settings: `useSettings()` (`backdrop`), `updateSettings(patch)`, `SectionId` includes `"ssh"`, nav settings route section includes `"ssh"`.
- `GITHUB_HOST` (`src/features/forge/gate.ts`), `useOpenIntegrations()` and `errorMessage` (`src/features/forge/helpers.ts`), `relativeDate` (`src/features/graph/format.ts`).
- Design: `Popover`, `PopoverTrigger`, `PopoverContent`, `IconButton`, `Tooltip`, `Button`, `Input`, `Label`, `Switch`, `Badge`, `EmptyState`, `Spinner`, `Tabs*`, `SegmentedControl`, `ListRow`.

## Behavior

### 1. Capture every toast (`Toaster.tsx`)

Replace `export { toast } from "sonner"` with a wrapper that records then forwards **the exact same arguments** to sonner, so existing `vi.mock("sonner")` spies keep seeing identical calls:

```ts
import { toast as sonnerToast } from "sonner";
// toast(m, d) -> info; toast.success / error / warning / info -> that level; toast.message -> info;
// toast.dismiss, toast.loading, toast.promise, toast.custom -> forwarded, not recorded.
// Record only when `m` is a string: push({ level, title: m, detail: typeof d?.description === "string" ? d.description : null }).
export const toast: typeof sonnerToast = Object.assign(/* ... */);
```

Resolve `sonnerToast.<method>` at call time (tests replace the module). `src/design/components/toaster.test.ts`: each variant forwards identical arguments and records the right level; JSX messages are forwarded but not recorded; `dismiss` is not recorded.

### 2. Notifications button and popover (`NotificationsButton.tsx`, `NotificationsPopover.tsx`)

- Button: `IconButton size="sm"` with `Bell` (`BellDot` when anything is unread), `aria-label` "Notifications" or "Notifications, N unread", Tooltip "Notifications"; a small accent badge with the count (`9+` above 9) positioned on the icon, `aria-hidden` (the label carries the number). Unread = app unread + GitHub unread.
- GitHub data: `const source = useForgeTokenSource(GITHUB_HOST)`; `useForgeNotifications(GITHUB_HOST, { enabled: source.data !== undefined && source.data !== "none" })`.
- Popover (`PopoverContent align="end" className="w-96 p-0"`), two tabs (`Tabs`): **Activity** and **GitHub** (the GitHub tab label shows its unread count).
  - Activity: newest first; each row: level icon (`CircleCheck` success / `CircleAlert` error / `TriangleAlert` warning / `Info` info, with the level as `sr-only` text), title (wraps, plain text), detail (muted, clamp 2 lines), "source · relative time". Footer buttons "Mark all read" and "Clear". Empty state "No activity yet". Opening the popover marks app items read after it has been shown (on close, or after the first render while open).
  - GitHub: no token → muted text "Connect GitHub to see your notifications" + button "Add a GitHub token" (`useOpenIntegrations()`, closes the popover); loading spinner; error → the message and, for `unsupported` errors, the hint is already in the message (classic token with the notifications scope); list rows: kind icon (`GitPullRequest` / `CircleDot` / `GitCommitHorizontal` / `Tag` / `Bell`), title, `repo · reason · relative time`; clicking a row with `url` calls `openUrl(url)` (failure → `toast.error`), rows without url are not interactive. Footer link-button "Open all on GitHub" → `openUrl("https://github.com/notifications")`.
- Scrollable body capped at `max-h-[min(28rem,70vh)]`.

### 3. Settings dialog and page

- `SettingsDialog.tsx` `SECTIONS`: `general, git, keyboard, ai, integrations, ssh ("SSH keys"), about`; `ssh` is listed only when `usePlatform().supportsSsh`. Render `<SshKeysSection />` for it. `SettingsPage.tsx` (compact): add `ssh` to its section list under the same condition.
- General: new `Row` "Background gradients", description "Soft gradients behind the commit graph and on the Home page. They stay still when your system asks for reduced motion.", `Switch id="settings-backdrop"` bound to `useSettings().backdrop` → `updateSettings({ backdrop })`.
- About: the documentation link becomes a button calling `openUrl(DOCS_URL)` (it is a github.com URL), with a fallback `toast.error` on failure.

### 4. SSH keys (`SshKeysSection.tsx`)

- `useSshKeys()`; header text "Keys in <dir>" (mono). Loading spinner; error message with Retry.
- Each key: a card with name, algorithm badge, fingerprint (mono, selectable), comment, a read-only monospace field with the public key (truncated visually, full text selectable) and buttons **Copy public key** (`navigator.clipboard.writeText(publicKey)`, `toast.success("Public key copied")`), **Add to GitHub** (`openUrl("https://github.com/settings/ssh/new")`), **Add to GitLab** (`openUrl("https://gitlab.com/-/user_settings/ssh_keys")`). A key without its private file shows a `Badge` "Public key only".
- Empty state: "No SSH keys yet" with the generate form visible.
- Generate form (`form aria-label="Generate SSH key"`): Name (`Input`, default `id_ed25519` when no key has that name, else `id_ed25519_gittrunk`; client-side check `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, not ending in `.pub`, not an existing key name), Comment (default `useGitIdentity().data?.email ?? ""`), Passphrase and Confirm passphrase (`type="password"`, optional, must match), note "Ed25519 key. Leave the passphrase empty for no passphrase.". Submit → `useGenerateSshKey().mutateAsync({ name, comment, passphrase: passphrase || null })`; on success clear the passphrase fields, `toast.success("Created <name>")` and scroll/focus the new key; errors inline (`role="alert"`).

### 5. Integrations (`Integrations.tsx`)

- Keep the existing GitHub token form and Avatars section behavior (and their tests).
- Wrap GitHub in a card titled "GitHub" with its status line; update the help text: classic token with `repo` (or `public_repo`) for issues and pull requests, plus the `notifications` scope for GitHub notifications; or a fine-grained token with Issues, Pull requests and Contents read/write (fine-grained tokens cannot read notifications).
- Add cards "GitLab" and "Bitbucket and Gitea", each with a "Coming soon" `Badge` and one line: "Issues, merge requests and notifications are not available yet. Repositories on <host> still work for fetch, pull and push." No token field, no button.
- Order: GitHub, GitLab, Bitbucket and Gitea, then Avatars.

## Tests

- `toaster.test.ts` (above).
- `notifications.test.tsx`: toasts raised through `toast.success/error` appear in Activity with the active repo name; the bell label shows the unread count and drops to "Notifications" after the popover was opened; "Clear" empties it; GitHub tab with token lists `forgeNotifications` rows and clicking one calls `appOpenUrl(url)`; without token shows "Add a GitHub token" and `forgeNotifications` is never called; an `unsupported` error shows its message; titles containing `<b>x</b>` render as text.
- `ssh.test.tsx`: section hidden with the Android platform mock; keys listed with fingerprint and "Public key only" badge; Copy writes the public key to the clipboard (mock `navigator.clipboard`); "Add to GitHub" calls `appOpenUrl("https://github.com/settings/ssh/new")`; generate validates the name and passphrase match, calls `sshKeyGenerate({ name, comment, passphrase })` (`passphrase: null` when empty), clears the passphrase fields and shows the new key; a backend error stays inline.
- `settings.test.tsx`: the Background gradients switch calls `settingsSet` with `backdrop: false`; the section list includes "SSH keys" on desktop.
- `integrations.test.tsx`: GitLab and Bitbucket cards show "Coming soon" and no input; existing token tests still pass.

## Prove it

```bash
cd /home/user/wt-settings-m10-topright && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm build
```

## Acceptance criteria

- Tests above pass; whole suite green (existing tests that spy on `sonner` unchanged); lint/format/typecheck/build exit 0.
- No passphrase or token value in any toast, log or notification; no private key handling in the UI.
- The GitHub notifications query never runs without a token and never polls faster than every 5 minutes.
- The popover and the SSH section are fully keyboard operable and labelled.

## Commits

`feat(design): record toasts as app notifications`, `feat(notifications): notifications popover with activity and GitHub`, `feat(settings): SSH keys section`, `feat(settings): integrations cards and background gradients switch`.

## Conflicts

- `settings.test.tsx` is yours; UI-START may adapt one assertion there (tab strip) in a separate commit.
- `Toaster.tsx`: only you edit it in M10; UI-BACKDROP edits other design files.
- `Integrations.tsx` lives under `features/forge/` but only you edit it in M10 (UI-PULLS edits `parts.tsx`).

## Out of scope / needs orchestrator

Marking GitHub notifications read, persisted notification history, GitLab/Bitbucket integrations, ssh-agent, testing SSH connections, RSA keys.
