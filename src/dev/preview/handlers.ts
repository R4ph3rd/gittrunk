/* Dev-only mocked backend for the /preview route: one handler per command in bindings.ts. */
import type { OpOutcome, commands } from "@/ipc/bindings";
import { ANDROID_PLATFORM, DESKTOP_PLATFORM } from "@/app/platform";
import {
  FORGE_REPO,
  GRAPH_META,
  GRAPH_ROWS,
  HEAD_OID,
  ISSUES,
  OPLOG,
  OPLOG_STATE,
  REFS,
  REMOTES,
  TERMINAL_BANNER,
  avatarForEmail,
  avatarForLogin,
  commitComments,
  commitDetails,
  commitFiles,
  fileDiff,
  fixtureRepoInfo,
  issueDetail,
  makeStatus,
  oidOf,
} from "./fixtures";

type CommandName = keyof typeof commands;
type Ok<K extends CommandName> = Extract<
  Awaited<ReturnType<(typeof commands)[K]>>,
  { status: "ok" }
>;
type Data<K extends CommandName> = Ok<K>["data"];

/** Positional arguments arrive as an object keyed by the binding's parameter names. */
export type Args = Record<string, unknown>;
type HandlerTable = { [K in CommandName]: (args: Args) => Data<K> | Promise<Data<K>> };

export interface PreviewOptions {
  platform: "desktop" | "android";
  theme: "dark" | "light" | "system";
  conflict: boolean;
  /** Called by the terminal handlers to deliver output through the mocked event system. */
  emit: (event: string, payload: unknown) => void;
}

const DEFAULTS: PreviewOptions = {
  platform: "desktop",
  theme: "dark",
  conflict: false,
  emit: () => undefined,
};

let options: PreviewOptions = DEFAULTS;
export const configureHandlers = (next: Partial<PreviewOptions>) => {
  options = { ...DEFAULTS, ...next };
};

const num = (v: unknown, fallback = 0) => (typeof v === "number" ? v : fallback);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

const HEAD = fixtureRepoInfo.head;

function mutation(message: string): (a: Args) => OpOutcome {
  return (a: Args) =>
    a.dryRun === true
      ? {
          kind: "preview",
          preview: {
            summary: `Will ${message}`,
            refUpdates: [{ name: "refs/heads/main", from: HEAD_OID, to: oidOf(999) }],
            commitsCreated: 1,
            commitsDropped: [],
            predictedConflicts: [],
            warnings: [],
          },
        }
      : { kind: "applied", oplogId: "preview-op", head: HEAD, message };
}

const nothing = () => null;
let terminalSeq = 0;

export const handlerTable: HandlerTable = {
  appInfo: () => ({
    version: "0.1.0-preview",
    gitVersion: "git version 2.47.0",
    platform: "linux",
  }),
  platformInfo: () => (options.platform === "android" ? ANDROID_PLATFORM : DESKTOP_PLATFORM),
  appExit: nothing,
  gitIdentityGet: () => ({ name: "R4ph3rd", email: "43202876+R4ph3rd@users.noreply.github.com" }),
  gitIdentitySet: (a) => ({ name: str(a.name), email: str(a.email) }),
  repoOpen: () => fixtureRepoInfo,
  repoInit: () => fixtureRepoInfo,
  repoClone: () => fixtureRepoInfo.path,
  repoClose: nothing,
  repoInfo: () => fixtureRepoInfo,
  repoRecent: () => [
    { path: fixtureRepoInfo.path, name: "gittrunk", lastOpened: 1_760_000_000 },
    { path: "/home/dev/dotfiles", name: "dotfiles", lastOpened: 1_759_000_000 },
  ],
  repoDelete: nothing,

  graphLoad: () => GRAPH_META,
  graphRows: (a) => GRAPH_ROWS.slice(num(a.start), num(a.start) + num(a.len)),
  graphSearch: (a) => {
    const search = a.search as { text: string; maxResults: number };
    const q = search.text.toLowerCase();
    return GRAPH_ROWS.filter(
      (r) => r.summary.toLowerCase().includes(q) || r.authorName.toLowerCase().includes(q),
    )
      .slice(0, search.maxResults)
      .map((r) => r.index);
  },
  graphFind: (a) => GRAPH_ROWS.find((r) => r.oid === a.oid)?.index ?? null,
  commitDetails: (a) => commitDetails(str(a.oid)),
  commitFileDiff: (a) => {
    const path = str(a.path);
    const file = commitFiles(str(a.oid)).find((f) => f.path === path);
    return fileDiff(path, file?.status ?? "modified");
  },
  refsList: () => REFS,

  branchCreate: mutation("create a branch"),
  branchDelete: mutation("delete the branch"),
  branchRename: mutation("rename the branch"),
  checkout: mutation("check out the target"),
  tagCreate: mutation("create a tag"),
  tagDelete: mutation("delete the tag"),
  refMove: mutation("move the ref"),

  status: () => makeStatus(options.conflict),
  worktreeFileDiff: (a) => fileDiff(str(a.path)),
  stagePaths: nothing,
  unstagePaths: nothing,
  discardPaths: mutation("discard the selected changes"),
  stageLines: nothing,
  unstageLines: nothing,
  discardLines: mutation("discard the selected lines"),
  commitCreate: mutation("create the commit"),

  stashList: () => REFS.stashes,
  stashSave: mutation("stash the changes"),
  stashApply: mutation("apply the stash"),
  stashDrop: mutation("drop the stash"),

  merge: mutation("merge the branch"),
  rebase: mutation("rebase the branch"),
  rebaseTodoLoad: () =>
    GRAPH_ROWS.slice(0, 4).map((r) => ({
      action: "pick" as const,
      oid: r.oid,
      summary: r.summary,
      message: null,
    })),
  rebaseInteractive: mutation("rewrite the history"),
  cherryPick: mutation("cherry-pick the commits"),
  revert: mutation("revert the commits"),
  reset: mutation("reset the branch"),
  sequencerControl: mutation("continue the operation"),

  conflictList: () => makeStatus(true).conflicted,
  conflictFile: (a) => ({
    path: str(a.path),
    binary: false,
    base: "const a = 1;\n",
    ours: "const a = 2;\n",
    theirs: "const a = 3;\n",
    merged: "<<<<<<< ours\nconst a = 2;\n=======\nconst a = 3;\n>>>>>>> theirs\n",
    oursLabel: "main",
    theirsLabel: "feature/avatars",
  }),
  conflictResolve: nothing,

  remoteList: () => REMOTES,
  remoteAdd: (a) => ({
    name: str(a.name),
    fetchUrl: str((a.request as { url?: string } | undefined)?.url),
    pushUrl: null,
    provider: "other",
  }),
  remoteRemove: nothing,
  remoteRename: nothing,
  remoteSetUrl: nothing,
  fetch: () => "Fetched origin",
  pull: () => "Already up to date",
  push: () => "Pushed main to origin",
  setUpstream: nothing,
  credentialRespond: nothing,
  credentialStore: nothing,
  credentialClear: nothing,

  submoduleList: () => [],
  submoduleUpdate: () => "Submodules updated",
  worktreeList: () => [
    {
      path: fixtureRepoInfo.path,
      branch: "main",
      head: HEAD_OID,
      isMain: true,
      locked: false,
      prunable: false,
    },
    {
      path: "/home/dev/gittrunk-avatars",
      branch: "feature/avatars",
      head: GRAPH_ROWS[4]?.oid ?? null,
      isMain: false,
      locked: false,
      prunable: false,
    },
  ],
  worktreeAdd: (a) => ({
    path: str((a.request as { path?: string } | undefined)?.path),
    branch: null,
    head: HEAD_OID,
    isMain: false,
    locked: false,
    prunable: false,
  }),
  worktreeRemove: nothing,

  blame: (a) => ({
    path: str(a.path),
    lines: ["export function render() {", "  return null;", "}"],
    hunks: [
      {
        oid: HEAD_OID,
        authorName: "R4ph3rd",
        authorTime: 1_760_000_000,
        summary: "feat(graph): render lane edges",
        startLine: 1,
        lineCount: 3,
        origPath: str(a.path),
      },
    ],
  }),
  fileHistory: (a) =>
    GRAPH_ROWS.slice(0, 5).map((r) => ({
      commit: {
        oid: r.oid,
        shortOid: r.shortOid,
        summary: r.summary,
        authorName: r.authorName,
        authorTime: r.authorTime,
      },
      path: str(a.path),
      status: "modified" as const,
    })),
  reflog: () =>
    GRAPH_ROWS.slice(0, 4).map((r, index) => ({
      index,
      oldOid: r.parents[0] ?? r.oid,
      newOid: r.oid,
      message: `commit: ${r.summary}`,
      committer: {
        name: "R4ph3rd",
        email: "43202876+R4ph3rd@users.noreply.github.com",
        time: r.authorTime,
        offsetMinutes: 120,
      },
    })),

  oplogList: () => OPLOG,
  undo: mutation("undo: Checkout main"),
  redo: mutation("redo: Merge feature/avatars"),
  opCancel: nothing,
  oplogState: () => OPLOG_STATE,

  avatarsGet: (a) =>
    (a.subjects as { kind: string; email?: string; login?: string }[]).map((s) =>
      s.kind === "email" ? avatarForEmail(s.email ?? "") : avatarForLogin(s.login ?? ""),
    ),

  forgeStatus: () => ({ repo: FORGE_REPO, supported: true, tokenSource: "forge" }),
  forgeTokenSource: () => "forge",
  forgeTokenSet: () => ({ login: "R4ph3rd" }),
  forgeTokenClear: nothing,
  forgeIssues: (a) => {
    const q = a.query as { state: "open" | "closed" | "all" };
    return {
      items: ISSUES.filter((i) => q.state === "all" || i.state === q.state),
      nextPage: null,
    };
  },
  forgeIssue: (a) => issueDetail(num(a.number)),
  forgeIssueCreate: (a) => {
    const req = a.request as { title: string };
    return {
      ...(ISSUES[0] ?? issueDetail(12).issue),
      number: 13,
      title: req.title,
      state: "open",
      comments: 0,
    };
  },
  forgeIssueComment: (a) => ({
    id: "new-comment",
    author: { login: "R4ph3rd" },
    body: str(a.body),
    createdAt: 1_760_000_000,
    url: "https://github.com/R4ph3rd/gittrunk/issues/12#issuecomment-99",
  }),
  forgeCommitComments: (a) => commitComments(str(a.oid)),
  forgeCommitComment: (a) => ({
    id: "new-commit-comment",
    author: { login: "R4ph3rd" },
    body: str(a.body),
    createdAt: 1_760_000_000,
    url: "https://github.com/R4ph3rd/gittrunk/commit/abc#commitcomment-99",
  }),

  terminalOpen: () => {
    const id = `preview-term-${++terminalSeq}`;
    // The panel subscribes to output asynchronously: deliver the banner a bit later.
    setTimeout(() => options.emit("terminal-output", { id, data: TERMINAL_BANNER }), 700);
    return id;
  },
  terminalWrite: (a) => {
    // Echo typed input back so the fake shell feels alive.
    options.emit("terminal-output", { id: str(a.id), data: str(a.data) });
    return null;
  },
  terminalResize: nothing,
  terminalClose: nothing,

  aiSettingsGet: () => ({
    enabled: false,
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    baseUrl: null,
    maxDiffBytes: 60_000,
    hasKey: false,
  }),
  aiSettingsSet: (a) => a.settings as Data<"aiSettingsSet">,
  aiKeySet: nothing,
  aiKeyClear: nothing,
  aiPayloadPreview: () => ({ bytes: 0, files: [], truncated: false, content: "" }),
  aiRun: () => ({ kind: "text", text: "AI is disabled in the preview." }),
  aiPlanExecute: mutation("run the plan"),

  settingsGet: () => ({
    theme: options.theme,
    gitPath: null,
    pullStrategy: "merge",
    confirmDestructive: true,
    graphOrder: "topo",
    diffContextLines: 3,
    avatars: "github",
  }),
  settingsSet: (a) => a.settings as Data<"settingsSet">,
  keybindingsGet: () => [],
  keybindingsSet: (a) => a.bindings as Data<"keybindingsSet">,
};

export const toSnake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Handlers keyed by the wire (snake_case) command name. */
export const handlers: Record<string, (args: Args) => unknown> = Object.fromEntries(
  Object.entries(handlerTable).map(([name, fn]) => [toSnake(name), fn]),
);

/** The `mockIPC` callback. Unknown commands throw so drift from bindings.ts is visible. */
export function handleCommand(cmd: string, payload?: unknown): unknown {
  const handler = handlers[cmd];
  if (handler) return handler((payload ?? {}) as Args);
  // Tauri plugins (dialog, window, ...) are not part of bindings.ts: succeed quietly.
  if (cmd.startsWith("plugin:")) return null;
  throw new Error(`[preview] no mock handler for command "${cmd}"`);
}
