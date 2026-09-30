import { installSettingsBackend } from "@/features/settings/testing";
/* Test helpers: a mocked backend contract and DOM shims for jsdom. Only imported from tests. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import type {
  CommitDetails,
  FileChange,
  FileDiff,
  GraphRow,
  OpOutcome,
  RepoInfo,
  StatusSnapshot,
} from "@/ipc/bindings";
import { useRepoStore } from "@/stores/repo";
import { App } from "./App";
import { DESKTOP_PLATFORM } from "./platform";

import { TooltipProvider } from "@/design/components";
import { useRemotesUi } from "@/stores/remotes";
import { useSettingsStore } from "@/stores/settings";
import { useOpsStore } from "@/features/ops/store";
import {
  emitCredentialRequested,
  emitOpFinished,
  emitOpProgress,
  emitRepoChanged,
  fail,
  names,
  ok,
} from "./mockBindings";

export { emitCredentialRequested, emitOpFinished, emitOpProgress, emitRepoChanged, fail, ok };

export const repoInfo: RepoInfo = {
  id: "r1",
  path: "/work/demo",
  name: "demo",
  head: { kind: "branch", name: "main", oid: oid(0) },
  state: "clean",
  isBare: false,
};

export function oid(i: number) {
  return i.toString(16).padStart(40, "0");
}

export function makeRow(i: number, rowCount = 1000): GraphRow {
  return {
    index: i,
    oid: oid(i),
    shortOid: oid(i).slice(0, 7),
    summary: `Commit number ${i}`,
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorTime: 1_700_000_000 - i * 3600,
    parents: i + 1 < rowCount ? [oid(i + 1)] : [],
    lane: 0,
    color: 0,
    edges: i + 1 < rowCount ? [{ fromLane: 0, toLane: 0, kind: "straight", color: 0 }] : [],
    refs:
      i === 0
        ? [{ name: "main", fullName: "refs/heads/main", kind: "localBranch", isHead: true }]
        : [],
  };
}

export function makeDetails(id: string): CommitDetails {
  const sig = { name: "Ada", email: "ada@example.com", time: 1_700_000_000, offsetMinutes: 0 };
  const n = parseInt(id, 16);
  return {
    oid: id,
    parents: [oid(n + 1)],
    author: sig,
    committer: sig,
    summary: `Details for ${n}`,
    body: "Body text",
    files: [
      {
        path: "src/lib.rs",
        oldPath: null,
        status: "modified",
        additions: 3,
        deletions: 1,
        binary: false,
      },
    ],
    refs: [],
  };
}

export const applied = (message: string): OpOutcome => ({
  kind: "applied",
  oplogId: "op1",
  head: { kind: "branch", name: "main", oid: oid(0) },
  message,
});

export const previewOutcome = (summary: string, warnings: string[] = []): OpOutcome => ({
  kind: "preview",
  preview: {
    summary,
    refUpdates: [],
    commitsCreated: 0,
    commitsDropped: [],
    predictedConflicts: [],
    warnings,
  },
});

export const change = (path: string, status: FileChange["status"] = "modified"): FileChange => ({
  path,
  oldPath: null,
  status,
  additions: 1,
  deletions: 1,
  binary: false,
});

export function makeStatus(parts: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return { state: "clean", staged: [], unstaged: [], conflicted: [], ...parts };
}

/** A two-hunk diff: hunk 0 has lines [ctx, -a, -b, +A, +B, +C, ctx], hunk 1 has [ctx, +z, ctx]. */
export function makeWorktreeDiff(path = "src/lib.rs"): FileDiff {
  const line = (
    kind: "context" | "add" | "delete",
    oldLineno: number | null,
    newLineno: number | null,
    content: string,
  ) => ({ kind, oldLineno, newLineno, content });
  return {
    path,
    oldPath: null,
    status: "modified",
    binary: false,
    hunks: [
      {
        header: "@@ -1,4 +1,5 @@",
        oldStart: 1,
        oldLines: 4,
        newStart: 1,
        newLines: 5,
        lines: [
          line("context", 1, 1, "top"),
          line("delete", 2, null, "old a"),
          line("delete", 3, null, "old b"),
          line("add", null, 2, "new A"),
          line("add", null, 3, "new B"),
          line("add", null, 4, "new C"),
          line("context", 4, 5, "bottom"),
        ],
      },
      {
        header: "@@ -20,2 +21,3 @@",
        oldStart: 20,
        oldLines: 2,
        newStart: 21,
        newLines: 3,
        lines: [
          line("context", 20, 21, "before"),
          line("add", null, 22, "added z"),
          line("context", 21, 23, "after"),
        ],
      },
    ],
  };
}

type Mocked = Record<(typeof names)[number], ReturnType<typeof vi.fn>>;

/** Installs default implementations on the mocked commands. */
export async function installBackend(rowCount = 1000, searchHits: number[] = []) {
  const { commands } = (await import("@/ipc/bindings")) as unknown as { commands: Mocked };
  installSettingsBackend(commands);
  // Advanced views: empty by default; suites override as needed.
  commands.submoduleList.mockImplementation(() => ok([]));
  commands.worktreeList.mockImplementation(() => ok([]));
  commands.reflog.mockImplementation(() => ok([]));
  commands.fileHistory.mockImplementation(() => ok([]));
  commands.appInfo.mockImplementation(() =>
    ok({ version: "0.1.0", gitVersion: "git version 2.45.0", platform: "windows" }),
  );
  commands.platformInfo.mockImplementation(() => ok(DESKTOP_PLATFORM));
  commands.appExit.mockImplementation(() => ok(null));
  commands.gitIdentityGet.mockImplementation(() =>
    ok({ name: "Test User", email: "test@example.com" }),
  );
  commands.gitIdentitySet.mockImplementation((name: string, email: string) => ok({ name, email }));
  commands.repoDelete.mockImplementation(() => ok(null));
  commands.repoRecent.mockImplementation(() =>
    ok([{ path: "/work/demo", name: "demo", lastOpened: 1 }]),
  );
  commands.repoOpen.mockImplementation(() => ok(repoInfo));
  commands.repoClose.mockImplementation(() => ok(null));
  commands.repoInfo.mockImplementation(() => ok(repoInfo));
  commands.graphLoad.mockImplementation(() => ok({ rowCount, laneCount: 1, headRow: 0 }));
  commands.graphRows.mockImplementation((_r: string, start: number, len: number) =>
    ok(
      Array.from({ length: Math.max(0, Math.min(len, rowCount - start)) }, (_, k) =>
        makeRow(start + k, rowCount),
      ),
    ),
  );
  commands.graphSearch.mockImplementation(() => ok(searchHits));
  commands.commitDetails.mockImplementation((_r: string, id: string) => ok(makeDetails(id)));
  commands.commitFileDiff.mockImplementation(() =>
    ok({
      path: "src/lib.rs",
      oldPath: null,
      status: "modified",
      binary: false,
      hunks: [
        {
          header: "@@ -1,2 +1,2 @@",
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 2,
          lines: [
            { kind: "delete", oldLineno: 1, newLineno: null, content: "old line" },
            { kind: "add", oldLineno: null, newLineno: 1, content: "new line" },
          ],
        },
      ],
    }),
  );
  commands.refsList.mockImplementation(() =>
    ok({
      head: repoInfo.head,
      local: [
        {
          name: "main",
          fullName: "refs/heads/main",
          oid: oid(0),
          upstream: null,
          ahead: 0,
          behind: 0,
          isHead: true,
          remote: null,
        },
      ],
      remote: [],
      tags: [{ name: "v1.0", oid: oid(3), annotated: false, message: null }],
      stashes: [],
    }),
  );
  commands.status.mockImplementation(() => ok(makeStatus()));
  commands.worktreeFileDiff.mockImplementation((_r: string, path: string) =>
    ok(makeWorktreeDiff(path)),
  );
  for (const name of ["stagePaths", "unstagePaths", "stageLines", "unstageLines"] as const) {
    commands[name].mockImplementation(() => ok(null));
  }
  const dryRunnable =
    (message: string) =>
    (...args: unknown[]) =>
      ok(args[args.length - 1] === true ? previewOutcome(`Will ${message}`) : applied(message));
  commands.discardPaths.mockImplementation(dryRunnable("discard changes"));
  commands.discardLines.mockImplementation(dryRunnable("discard lines"));
  commands.stashDrop.mockImplementation(dryRunnable("drop stash"));
  commands.commitCreate.mockImplementation(() => ok(applied("Committed abc1234")));
  commands.stashList.mockImplementation(() => ok([]));
  commands.stashSave.mockImplementation(() => ok(applied("Changes stashed")));
  commands.stashApply.mockImplementation(() => ok(applied("Stash applied")));
  commands.undo.mockImplementation(() => ok(applied("Undone")));
  commands.checkout.mockImplementation(() => ok(applied("Checked out")));
  commands.branchDelete.mockImplementation(dryRunnable("delete branch"));
  for (const [name, msg] of [
    ["merge", "merge"],
    ["rebase", "rebase"],
    ["cherryPick", "cherry-pick"],
    ["revert", "revert"],
    ["reset", "reset"],
    ["refMove", "move ref"],
    ["branchCreate", "create branch"],
    ["tagCreate", "create tag"],
    ["tagDelete", "delete tag"],
  ] as const) {
    commands[name].mockImplementation(dryRunnable(msg));
  }
  commands.branchRename.mockImplementation(dryRunnable("rename branch"));
  commands.graphFind.mockImplementation(() => ok(null));
  commands.remoteList.mockImplementation(() =>
    ok([
      {
        name: "origin",
        fetchUrl: "https://example.com/demo.git",
        pushUrl: null,
        provider: "other",
      },
    ]),
  );
  commands.remoteAdd.mockImplementation((_r: string, req: { name: string; url: string }) =>
    ok({ name: req.name, fetchUrl: req.url, pushUrl: null, provider: "other" }),
  );
  for (const name of [
    "remoteRemove",
    "remoteRename",
    "remoteSetUrl",
    "setUpstream",
    "opCancel",
    "credentialRespond",
    "credentialStore",
    "credentialClear",
  ] as const) {
    commands[name].mockImplementation(() => ok(null));
  }
  for (const name of ["fetch", "pull", "push", "repoClone"] as const) {
    commands[name].mockImplementation(() => ok(`op-${name}`));
  }
  return commands;
}

/** jsdom has no layout: give elements a viewport so the virtualizer renders rows. */
export function installDomShims() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 560 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 900 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 560 });
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key) => (key === "measureText" ? () => ({ width: 8 }) : () => undefined),
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() =>
    ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

export function resetStore() {
  useRepoStore.setState({
    repos: [],
    activeId: null,
    selection: {},
    stashDialog: {},
    filters: {},
    openError: null,
  });
  useOpsStore.getState().reset();
  useRemotesUi.getState().reset();
  useSettingsStore.setState({ settings: null });
}

export function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}
