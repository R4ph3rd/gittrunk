# History views

Blame, file history, reflog, plus the Submodules and Worktrees sidebar sections.

## Where views open

Blame, file history and reflog open in one large **modal panel** over the repo view (a Radix
dialog, 80% of the viewport height). Choice rationale: `RepoView` is shared layout owned
elsewhere, and a dialog gives Escape-to-close and focus return for free. Clicking a hunk,
"Reveal in graph" or a reflog "Reveal" runs `graphFind`, selects the commit (the graph scrolls to
it) and closes the panel. A commit outside the graph shows a warning toast and leaves the panel
open. Views switch in place: blame has "File history", history has "Blame" and "Blame at this
revision".

## Mounting

`HistoryViewsHost` is rendered by `RefsSidebar` (always mounted per repo), so nothing needs
mounting in the app shell. It registers the palette commands `history.blame` ("Blame file…"),
`history.fileHistory` ("File history…"), `history.reflog` ("Show reflog"), `worktree.add`
("Add worktree…") and `submodule.update` ("Update all submodules").

## Entry points

- Commit details: file rows have Blame / File history buttons (visible on hover and focus) and a
  context menu. Blame from there uses the selected commit as `rev`.
- Palette: "Blame file…" and "File history…" ask for a path, suggesting the selected commit's files.
- Branch context menu in the sidebar: Show reflog, Summarize branch, Draft PR description
  (base = upstream or `main`).
- Programmatic: `openBlame`, `openFileHistory`, `openReflog` from `./store`.

## Notes

- Queries live in `queries.ts`. History data is keyed under the graph key and submodules/worktrees
  under the refs key, so `repo-changed` refs events refresh them.
- Submodule update runs through the op tracker (`runOp`, kind `fetch`; there is no submodule
  kind in the ops store).
- `worktreeRemove` has no dry run, so its confirmation dialog is the preview; a failed removal
  pre-checks "Force". It cannot be undone through the oplog.
- Reflog "Checkout this commit" goes through `requestOperation` (dry run, confirmation when the
  preview or the setting asks for it).
- Tests: `testing.ts` adds the extra command mocks (`installHistoryBackend`).
