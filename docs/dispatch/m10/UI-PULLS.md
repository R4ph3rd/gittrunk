# UI-PULLS: Pull Requests section, center views and mobile screens

- Wave: 1 (after C10 is merged; parallel with B10, UI-START, UI-BACKDROP, UI-TOPRIGHT)
- Agent: `frontend-agent`, model **sonnet**
- Branch/worktree: `feat/forge-m10-pulls`
- Read first: `docs/PLAN.md` §13 (item 4); the M9 issue implementation you mirror: `src/features/forge/{IssuesSection.tsx,ForgeMainView.tsx,IssueViews.tsx,parts.tsx,gate.ts,helpers.ts,testing.ts,forge.test.tsx,forge.mobile.test.tsx}`, `src/features/forge/mobile/{screens.tsx,contrib.ts}`, `src/app/shell/{CenterArea.tsx,CenterHeader.tsx}`, `src/features/repo/RefsSidebar.tsx`, `src/features/repo/SidebarParts.tsx`.
- Frontend only: never run cargo, `pnpm bindings` or `pnpm tauri`.

## Goal

There is nowhere to see pull requests. Add a **Pull requests** sidebar section above Issues (first 10 open PRs: author avatar, `#number title`, head-branch chip in the branch's lane color, draft marker), a center **pull request list** (open / closed / all) and a **pull request detail** (state, author, head → base chips, stats, plain-text description, conversation comments with a composer, Check out branch, Open on GitHub, Copy link). On compact layouts the Issues tab gets an `Issues / Pull requests` switch and a `pull` route. Read-only platforms (Android) can view, comment and check out existing branches.

## Rules (every M10 brief)

- Repo `/home/user/gittrunk`, integration branch `claude/relaxed-allen-0mjwae`. Worktree: `git -C /home/user/gittrunk worktree add /home/user/wt-forge-m10-pulls -b feat/forge-m10-pulls claude/relaxed-allen-0mjwae`; work only there with absolute paths; `pnpm install --frozen-lockfile` once.
- Touch only "Owned files". Need a hook, type, store field, token or dependency? Do not edit it: list it under "Needs orchestrator" and work around locally.
- Styling: tokens only (`bg-surface`, `text-fg-muted`, `border-border`, `var(--token)`); lane colors only via `laneVar(color)` from `src/lib/laneColor.ts` in inline styles; no hex/rgb, no Tailwind palette classes. lucide-react icons; icon-only buttons have `aria-label` + `Tooltip`; keyboard reachable.
- **Untrusted text**: PR titles, bodies, branch names, labels and comments render as plain React text only (no `dangerouslySetInnerHTML`, no Markdown, no `href` built from body text).
- Capabilities from `usePlatform()` (`readOnly`), layout from `useLayout()`; never infer one from the other.
- Tests: Vitest + Testing Library with mocked bindings (`bindingsMock()`, `sonnerMock()` from `src/app/mockBindings.ts`), `installBackend()`, `installDomShims()`, `resetStore()`, `renderApp()` / `renderAppAt(390, 844)` from `src/app/testing.tsx`, or `renderWithClient` from `src/features/forge/testing.ts`. Android: `commands.platformInfo.mockImplementation(() => ok(ANDROID_PLATFORM))`. Whole suite green; foreign test assertions you break are adapted in a separate `test(<scope>)` commit and listed.
- e2e invariants (keep): graph `aria-label="Commit graph"` with `role="row"` rows and `span[data-kind="localBranch"]` labels; `Esc` / "Back to graph" returns from a center view.
- Commits: Conventional Commits with a scope, made with
  `git -c user.name=Claude -c user.email=noreply@anthropic.com commit --author="R4ph3rd <43202876+R4ph3rd@users.noreply.github.com>" -F - <<'EOF' ... EOF`; every message ends with a blank line and exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FzHMmoKCskK5U6Gdp6AZmv
  ```
  Do not push, rebase or merge.
- Report back: branch and hashes; every gate with exit code; acceptance one line each; deviations; "Needs orchestrator"; foreign tests adapted; anything visual you could not verify.

## Owned files

Create: `src/features/forge/pulls/{PullsSection.tsx,PullMainView.tsx,PullList.tsx,PullDetail.tsx,parts.tsx,checkout.ts,testing.ts,pulls.test.tsx,pulls.mobile.test.tsx}`, `src/features/forge/mobile/pullScreens.tsx`.
Modify: `src/app/shell/CenterArea.tsx`, `src/app/shell/CenterHeader.tsx` (pull views only), `src/features/repo/RefsSidebar.tsx` (one mount line + import), `src/features/forge/mobile/{screens.tsx,contrib.ts}`, `src/features/forge/parts.tsx` (add `OpenInBrowserButton` only), `src/app/shell/workbench.test.tsx` (primary owner in M10).
Must NOT touch: `src/stores/**`, `src/ipc/**`, `src/design/**`, `src/features/forge/{Integrations.tsx,IssuesSection.tsx,ForgeMainView.tsx,IssueViews.tsx,gate.ts,helpers.ts,testing.ts}`, other `src/features/repo/**` files, `src/app/App.tsx`, `src/features/repo/RepoTabs.tsx`.

## Contracts you use (merged by C10; read the real files)

- Types (`src/ipc/bindings.ts`): `ForgePull { number, title, state: "open"|"closed"|"merged", draft, author: { login }, head: PullBranch, base: PullBranch, labels, createdAt, updatedAt, url }`, `PullBranch { name, label, sha, repo: string|null, isFork }`, `PullDetail { pull, body, comments: ForgeComment[], commits, additions, deletions, changedFiles, mergeable }`, `PullStateFilter = "open"|"closed"|"all"`.
- Hooks (`src/ipc/queries.ts`): `usePulls(repoId, state, { enabled?, perPage? })` (infinite query, `pages[].items`, `hasNextPage`, `fetchNextPage`), `usePull(repoId, number|null)`, `useAddPullComment(repoId, number)` (mutation, arg = body), `openUrl(url): Promise<void>`, `useForgeStatus(repoId)` (`repo.remote` = remote name, e.g. "origin"), `useRefColors(repoId): ReadonlyMap<fullName, color>`, `useRefs(repoId)`, `useAvatar({ kind: "githubLogin", login }, size?)`, `invalidateAfterOp(client, repoId)`, `queryKeys`.
- Stores: `openPulls(repoId)`, `openPull(repoId, number)`, `useCenterView(repoId)`, `useWorkspaceStore` (`back`), `PullCenterView` (`src/stores/workspace.ts`); `useNav()` and route `{ name: "pull"; number }` (`src/stores/nav.ts`).
- Forge helpers to reuse as is: `useForgeGate(repoId)` (`gate.ts`: `loading | error | noRemote | unsupported | ready { canWrite, host }`), `ForgeError`, `CommentItem`, `CommentThread`, `CommentComposer`, `CopyLinkButton`, `AddTokenButton`, `Muted` (`parts.tsx`), `errorMessage`, `commentsLabel` (`helpers.ts`).
- Sidebar parts: `Section({ title, count, actions?, children })`, `Item({ label, leading?, badges?, hint?, onClick })` (`src/features/repo/SidebarParts.tsx`).
- Git helpers: `loadRefs(client, repoId)` (`src/features/remotes/actions.ts`), `runOp({ kind, repoId, label, doneLabel, start, onSuccess })` (`src/features/ops/ops.tsx`), `commands.checkout(repoId, target, dryRun)` with `CheckoutTarget` `{ kind: "branch", name } | { kind: "remoteBranch", name, localName }`, `commands.fetch(repoId, { remote, prune, tags })`.
- Design: `Avatar`, `Badge`, `Button`, `IconButton`, `SegmentedControl`, `Spinner`, `EmptyState`, `ListRow`, `PullToRefresh`, `Tooltip`, `toast`; `relativeDate`, `absoluteDate` (`src/features/graph/format.ts`); `ShellAppBar` (`src/app/layout/ShellAppBar.tsx`), `RouteScreenProps`, `ScreenContribution` (`src/app/layout/registry.ts`).

## Behavior

### Shared parts (`pulls/parts.tsx`)

- `BranchChip({ repoId, branch, remote })`: GitBranch icon (12px, `aria-hidden`) + name in a mono chip (`rounded-sm border px-1.5 text-xs`). Color: for non-fork branches `useRefColors(repoId).get("refs/heads/<name>") ?? .get("refs/remotes/<remote>/<name>")`; when found, `style={{ color: laneVar(c), borderColor: laneVar(c) }}`; otherwise `text-fg-muted border-border`. Forks show `branch.label` (owner:branch), always neutral. `title` attribute = label.
- `PullStateBadge({ pull })`: Draft (open + draft, `GitPullRequestDraft`, `text-fg-muted`), Open (`GitPullRequest`, `text-success`), Merged (`GitMerge`, color `var(--lane-3)`), Closed (`GitPullRequestClosed`, `text-danger`); icon + text, never color alone.
- `PullStateIcon` (icon only, `aria-hidden`, same colors) for dense rows.
- Texts: `NO_REMOTE = "Pull requests need a GitHub remote"`, `UNSUPPORTED = "GitLab merge requests are not supported yet"`.

### Sidebar (`PullsSection.tsx`, mounted in `RefsSidebar.tsx` right before `<IssuesSection repoId={repoId} />`)

Same structure and states as `IssuesSection` (loading / no remote / unsupported / error with retry / empty "No open pull requests"): `Section title="Pull requests" count=<loaded open count>`; up to 10 rows, each an `Item` with `leading` = 16px author `Avatar` (row component calling `useAvatar`), `label` = `#<n> <title>`, `badges` = draft `Badge` (if draft) + `BranchChip` of the head; click → `openPull(repoId, n)`; last row "Show all pull requests" → `openPulls(repoId)`. No create action (out of scope). Fetches once per stale period, never polls.

### Center (`CenterArea.tsx`, `CenterHeader.tsx`, `PullMainView.tsx`, `PullList.tsx`, `PullDetail.tsx`)

- `CenterArea`: `pulls` and `pull` views render `<PullMainView repoId view={shown} />` in a `min-h-0 flex-1 overflow-auto bg-surface` container, like the forge views. `CenterHeader`: "Pull requests" and `Pull request #<n>`.
- `PullMainView` handles the gate like `ForgeMainView` (spinner, error, empty state with the texts above) and has `data-testid="pull-main-view" data-view={view.kind}`.
- `PullList`: `SegmentedControl` Open / Closed / All (`aria-label="Pull request state"`); `ul aria-label="Pull requests"` of rows: state icon, `#n` mono, title, draft and label badges, `BranchChip head` → `BranchChip base`, author avatar + login, "updated <relative>"; "Load more" when `hasNextPage`; empty state per filter.
- `PullDetail`: `h2` title + `#n`; `PullStateBadge`; line "<login> wants to merge <commits> commits into <base chip> from <head chip>" (merged/closed wording: "merged" / "closed", relative dates with absolute `title`); stats "+<additions> −<deletions> · <changedFiles> files" (`text-success` / `text-danger` numbers, words in `text-fg-muted`); action row: **Check out branch** (see below), **Open on GitHub** (`OpenInBrowserButton url={pull.url}`), `CopyLinkButton`; description as `CommentItem` with `emptyText="No description provided."`; `CommentThread`; `CommentComposer` (label "Add a comment", `canWrite = gate.canWrite`, submit → `useAddPullComment(...).mutateAsync(body)`).
- `OpenInBrowserButton({ url })` in `src/features/forge/parts.tsx`: `Button size="sm"` with `ExternalLink` icon, text "Open on GitHub"; click → `openUrl(url)`; on failure `toast.error("Could not open the link: <message>")`.

### Check out (`checkout.ts`)

```ts
/** Checks out the PR head branch: local branch, else a tracking branch, else fetch then retry. */
export async function checkoutPull(
  client: QueryClient,
  repoId: string,
  pull: ForgePull,
  remote: string,
): Promise<void>;
```

1. Forks (`head.isFork`): no checkout (the button is not rendered; a muted hint "From a fork: open it on GitHub to review").
2. `refs = await loadRefs(client, repoId)`. If HEAD is already on `head.name`, the button shows a disabled "Checked out" state.
3. Local branch `head.name` exists → `checkout(repoId, { kind: "branch", name }, false)`.
4. Else remote branch `<remote>/<head.name>` exists → `checkout(repoId, { kind: "remoteBranch", name: "<remote>/<head.name>", localName: head.name }, false)`.
5. Else `runOp({ kind: "fetch", repoId, label: "Fetching <remote>", doneLabel: "Fetch complete", start: () => unwrap(commands.fetch(repoId, { remote, prune: false, tags: false })), onSuccess: () => retry steps 3-4 once })`; if the branch is still missing, `toast.error("Branch <name> not found on <remote>")`.
6. Success: `toast.success("Checked out <name>")`; errors (dirty tree, conflicts): `toast.error("Could not check out <name>: <message>")`; always `invalidateAfterOp(client, repoId)`. The button shows a spinner while running.

Allowed on read-only platforms (checking out an existing branch is permitted there, as in M9's "Checkout as local branch").

### Mobile (`mobile/screens.tsx`, `mobile/contrib.ts`, `mobile/pullScreens.tsx`)

- `IssuesScreen` gains a `SegmentedControl` at the top (`aria-label="Show"`, options "Issues" / "Pull requests"; local state, default Issues). The Issues content is unchanged; "Pull requests" renders `PullsList` from `pullScreens.tsx`: open/closed switch, `PullToRefresh`, `ListRow` per PR (title `#n title`, subtitle `login · head → base · updated <relative>`, leading state icon), tap → `nav.push({ name: "pull", number })`.
- `PullScreen` (route `pull`): `ShellAppBar` (`back`, title `#<n>`, subtitle "Pull request"), the same `PullDetail` content in a scroll area (pass a `compact` prop to stack the action row), composer at the bottom when `canWrite`.
- `contrib.ts`: `routes: { issue, newIssue, pull: PullScreen }`.

## Tests

`pulls/testing.ts`: `makePull(n, parts?)`, `makePullDetail(n, parts?)`, `pullsReady(commands, opts?)` (forge status ready with `remote: "origin"`, `forgePulls`, `forgePull`, `forgePullComment`, `avatarsGet`) in the style of `src/features/forge/testing.ts`.

`pulls/pulls.test.tsx` (desktop):

- Sidebar shows at most 10 PRs above Issues, with draft badge; the head chip has `style.color === "var(--lane-N)"` when `graphLoad` returns `refColors` for `refs/remotes/origin/<head>`, neutral for a fork and for unknown branches.
- Clicking a row opens the detail (`data-view="pull"`), header "Pull request #n", `Esc` goes back; "Show all pull requests" opens the list; filter switch requests `state: "closed"`.
- A body containing `<img src=x onerror=alert(1)>` renders as text (no `img` element in the detail).
- "Open on GitHub" calls `appOpenUrl` with `pull.url`; a failure toasts.
- Checkout: local branch exists → `checkout` with `{ kind: "branch" }`; only remote → `{ kind: "remoteBranch", name: "origin/<head>", localName: "<head>" }`; neither → `fetch` then, after `emitOpFinished`, checkout; fork → no checkout button.
- Composer posts `forgePullComment(repoId, n, body)`; without a token it is disabled with "Add a GitHub token".
- No GitHub remote → "Pull requests need a GitHub remote"; GitLab → "GitLab merge requests are not supported yet".
- Android platform mock at desktop size: section, detail, checkout and composer are present.

`pulls/pulls.mobile.test.tsx` (`renderAppAt(390, 844)`, Android platform): Issues tab → "Pull requests" segment lists PRs; tapping one pushes the `pull` route and shows the detail; back returns.

## Prove it

```bash
cd /home/user/wt-forge-m10-pulls && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test; echo "vitest exit=$?"
pnpm build
```

## Acceptance criteria

- Tests above pass; whole suite green; lint/format/typecheck/build exit 0.
- No `dangerouslySetInnerHTML` or Markdown rendering in `src/features/forge/**` (`grep -rn dangerouslySetInnerHTML src/features/forge` is empty).
- Branch chips use `laneVar` only; state is conveyed by text or icon plus label, not color alone.
- Existing issue tests (`forge.test.tsx`, `forge.mobile.test.tsx`) pass unchanged.

## Commits

`feat(forge): pull requests sidebar section`, `feat(forge): pull request list and detail in the center`, `feat(forge): check out a pull request branch`, `feat(mobile): pull requests in the Issues tab`.

## Conflicts

- `src/app/shell/workbench.test.tsx` is yours; UI-START may adapt one assertion there in a separate commit (tab strip). Keep your edits to it focused on center views.
- `src/features/forge/parts.tsx`: only you edit it in M10 (UI-TOPRIGHT edits `Integrations.tsx`, not `parts.tsx`).
- `RefsSidebar.tsx`: only the mount line; nobody else edits it in M10.

## Out of scope / needs orchestrator

Creating, reviewing, merging or closing PRs; review comments; CI check status; PR diffs; GitLab merge requests.
