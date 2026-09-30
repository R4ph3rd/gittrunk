# UI-FORGE: issues and comments (desktop and mobile), Settings > Integrations

- Wave: 1
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/forge-ui`
- Read first: `docs/dispatch/m9/COMMON.md`, `docs/PLAN.md` §12.1 ("ISSUES", item 9), §12.2 (Forge, Avatars, Mobile navigation); merged contracts: `src/ipc/bindings.ts` (forge types, `AvatarMode`), `src/ipc/queries.ts` (forge hooks, `useAvatar`, `invalidateAvatars`), `src/stores/{workspace,nav,settings}.ts`, stubs `src/features/forge/**`, `src/app/layout/{registry.ts,ShellAppBar.tsx}`, `src/features/repo/SidebarParts.tsx` (`Section`, `Item`, `actions`, `leading`), `src/features/settings/{SettingsDialog,SettingsPage}.tsx`, design components (`Avatar`, `Badge`, `Button`, `IconButton`, `Input`, `ListRow`, `SegmentedControl`, `PullToRefresh`, `EmptyState`, `Spinner`, `Switch`).
- Frontend only.

## Goal

Browse, open and create GitHub issues and comment on issues and commits, on desktop (sidebar section + center views + commit comments) and on mobile (Issues tab, issue page, new issue, commit comments component), and configure the GitHub token and the avatar source in Settings > Integrations.

## Owned files

`src/features/forge/**` (replace the four stubs, keep their exports and props; add files freely), `src/features/settings/{SettingsDialog.tsx,SettingsPage.tsx}`, `src/stores/settings.ts` (`SectionId` adds `"integrations"` only); primary owner of `src/features/settings/settings.test.tsx`; new `src/features/forge/{forge.test.tsx,forge.mobile.test.tsx,integrations.test.tsx,testing.ts}`.
Must NOT touch: `src/app/**` (UI-MOBILE registers `forgeScreens`; UI-SHELL renders `ForgeMainView` and `CommitComments`; UI-SIDEBAR mounts `IssuesSection`), `src/ipc/**`, `src/stores/{nav,workspace}.ts`.

## Shared building blocks (`src/features/forge/`)

- `useForgeGate(repoId)`: from `useForgeStatus` returns one of `loading`, `noRemote` ("Issues need a GitHub remote"), `unsupported` (GitLab: "GitLab issues are not supported yet"), `ready` (+ `canWrite = tokenSource !== "none"`).
- `ForgeError`: maps `IpcError.kind`: `authRequired`/`authFailed` -> message + button "Add a GitHub token" (desktop: `useSettingsStore.getState().openDialog("integrations")`; compact: `nav.push({ name: "settings", section: "integrations" })`), `network` -> message + Retry, others -> message.
- `IssueStateBadge` (open: `text-success`, closed: `text-fg-muted`), `IssueRow` (`#N`, title, author login, relative updated time, comment count, labels as neutral `Badge`s), `CommentThread` (avatar via `useAvatar({ kind: "githubLogin", login })`, login, relative date with absolute in `title`, body as plain text `whitespace-pre-wrap break-words`), `CommentComposer` (textarea, `Ctrl/Cmd+Enter` submits, disabled with a hint when `!canWrite`, pending spinner, error inline, clears on success), "Copy link" buttons (clipboard) instead of external links. Never use `dangerouslySetInnerHTML` or a Markdown renderer.

## Desktop

- `IssuesSection` (sidebar): `Section title="Issues"` with `count` = loaded open issues, `actions` = `+` (`aria-label="New issue"`, only when `ready && canWrite`) -> `openNewIssue(repoId)`; items = first 10 open issues (`Item label="#N title"`, `leading` = state dot) -> `openIssue(repoId, n)`; a last item "Show all issues" -> `openIssues(repoId)`. States: loading (skeleton text), `noRemote`/`unsupported` (one muted line), errors (one line + action). It fetches once per stale period (5 min), also while collapsed, and never polls.
- `ForgeMainView({ repoId, view })`: `issues` -> filter `SegmentedControl` Open / Closed / All, list of `IssueRow` (click -> `openIssue`), "Load more" via `fetchNextPage`, "New issue" button; `issue` -> title, state badge, author + created date, body, comments, composer (`useAddIssueComment`), "Copy link"; `newIssue` -> form (title required, max 256; body textarea), Submit -> `useCreateIssue` -> `openIssue(repoId, created.number)` replacing the form (`back` then `openIssue`), Cancel -> `back`. Content only: UI-SHELL renders the header and back button.
- `CommitComments({ repoId, oid })`: renders nothing unless `ready`; a collapsible "Comments (n)" block at the bottom of the commit details: thread + composer (`useAddCommitComment`); `invalidInput` "This commit is not on GitHub" shown as a muted note, not an error.

## Mobile (`src/features/forge/mobile/`)

`forgeScreens: ScreenContribution = { tabs: { issues: IssuesScreen }, routes: { issue: IssueScreen, newIssue: NewIssueScreen } }`. Each screen renders `<ShellAppBar …/>` first (title "Issues" / "Issue #N" / "New issue", back on routes). IssuesScreen: `SegmentedControl` Open/Closed, `PullToRefresh` -> refetch, 52px `ListRow`s, infinite "Load more", AppBar action `+` (when `canWrite`) -> push `newIssue`; states as desktop. IssueScreen: same content as the desktop issue view in a scroll root, composer pinned to the bottom above the keyboard (`--kb-inset`). NewIssueScreen: title + body, Submit -> `replace({ name: "issue", number })`. `CommitComments` is also used by UI-MOBILE on the commit page (it must work at 390px).

## Settings > Integrations

New section "Integrations" in `SettingsDialog` (between AI and About) and in `SettingsPage` (compact list). Content:

- GitHub token: status line from `useForgeTokenSource("github.com")` ("Token saved", "Using the HTTPS credential saved for github.com", "No token: public repositories only, read-only"); password `Input` (`autoComplete="off"`, `spellCheck={false}`), Save (`useSetForgeToken`, success "Connected as @login", errors inline), Remove (`useClearForgeToken`, only when source is `forge`). Help: classic token with `repo` (or `public_repo`), or fine-grained with Issues and Contents read/write. The token value is cleared from state after saving and never displayed.
- Avatars: radio group Off / GitHub only / GitHub and Gravatar bound to `AppSettings.avatars` via `updateSettings({ avatars })`, then `invalidateAvatars(queryClient)`. Explanation: "Avatars are downloaded by gittrunk, not by the page. Gravatar receives a hash of each commit author's email."

## Tests (`testing.ts` provides `makeIssue`, `makeComment`, `forgeReady()` mocks)

`forge.test.tsx`: sidebar section states (no remote, GitLab, ready with issues, auth error with the token button), `+` visible only with a token, clicking an issue calls `openIssue`; issues view filters (`forgeIssues` called with `state`), Load more; issue view renders body/comments as text (a body containing `<img src=x onerror=alert(1)>` renders literally and creates no `img`); composer `Ctrl+Enter` posts and clears; new issue validation and navigation; commit comments hidden without forge, "not on GitHub" note. `forge.mobile.test.tsx` at `setViewport(390, 844)`: Issues tab screen list, pull-to-refresh refetch, push `issue`, composer, new issue replace. `integrations.test.tsx` + `settings.test.tsx`: token save success/failure, status lines, remove, avatar mode update calls `settingsSet` and invalidates avatar queries; section present in dialog and compact page.

## Prove it

```bash
cd <worktree> && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm vite build
grep -rn "dangerouslySetInnerHTML" src/features/forge; echo "expect no output"
```

## Acceptance criteria

- Tests green; full suite green; no HTML rendering of forge content.
- All views usable by keyboard; composer and forms labelled; errors announced (`role="alert"`).
- No raw colors (GitHub label colors are not used).

## Commits

`feat(forge): issues section and center issue views`, `feat(forge): comment on issues and commits`, `feat(forge): mobile issues screens`, `feat(settings): integrations section for the GitHub token and avatars`.

## Out of scope / needs orchestrator

Registering `forgeScreens` in the mobile shell (UI-MOBILE), center header (UI-SHELL), editing/closing issues, pull requests, Markdown rendering, opening links in a browser.
