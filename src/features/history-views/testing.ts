/* Test helpers for history views. Only imported from tests. */
import { vi } from "vitest";
import { installBackend, ok } from "@/app/testing";
import type {
  BlameResult,
  FileHistoryEntry,
  ReflogEntry,
  SubmoduleInfo,
  WorktreeInfo,
} from "@/ipc/bindings";

/** Distinct short ids: the shared `oid` helper only varies the tail of the hash. */
export const sha = (i: number) => i.toString(16).padStart(2, "0").padEnd(40, "0");

type Fn = ReturnType<typeof vi.fn>;
type Commands = Record<string, Fn>;

/** Commands the shared mock does not know about yet (it is owned elsewhere). */
const EXTRA = [
  "blame",
  "fileHistory",
  "reflog",
  "submoduleList",
  "submoduleUpdate",
  "worktreeList",
  "worktreeAdd",
  "worktreeRemove",
] as const;

export const sampleBlame: BlameResult = {
  path: "src/lib.rs",
  lines: ["fn one() {}", "fn two() {}", "fn three() {}", "fn four() {}", "fn five() {}"],
  hunks: [
    {
      oid: sha(11),
      authorName: "Ada",
      authorTime: 1_700_000_000,
      summary: "Add one and two",
      startLine: 1,
      lineCount: 2,
      origPath: "src/lib.rs",
    },
    {
      oid: sha(12),
      authorName: "Grace",
      authorTime: 1_700_100_000,
      summary: "Add three",
      startLine: 3,
      lineCount: 1,
      origPath: "src/lib.rs",
    },
    {
      oid: sha(13),
      authorName: "Linus",
      authorTime: 1_700_200_000,
      summary: "Add four and five",
      startLine: 4,
      lineCount: 2,
      origPath: "src/lib.rs",
    },
  ],
};

export const sampleHistory: FileHistoryEntry[] = [
  {
    commit: {
      oid: sha(21),
      shortOid: sha(21).slice(0, 7),
      summary: "Rename module",
      authorName: "Ada",
      authorTime: 1_700_000_000,
    },
    path: "src/new_name.rs",
    status: "renamed",
  },
  {
    commit: {
      oid: sha(22),
      shortOid: sha(22).slice(0, 7),
      summary: "Create module",
      authorName: "Grace",
      authorTime: 1_699_000_000,
    },
    path: "src/old_name.rs",
    status: "added",
  },
];

export const sampleReflog: ReflogEntry[] = [
  {
    index: 0,
    oldOid: sha(32),
    newOid: sha(31),
    message: "commit: second",
    committer: { name: "Ada", email: "ada@example.com", time: 1_700_000_000, offsetMinutes: 0 },
  },
  {
    index: 1,
    oldOid: sha(0),
    newOid: sha(32),
    message: "commit (initial): first",
    committer: { name: "Ada", email: "ada@example.com", time: 1_699_000_000, offsetMinutes: 0 },
  },
];

export const sampleSubmodules: SubmoduleInfo[] = [
  { name: "vendor-a", path: "vendor/a", url: null, headOid: null, status: "uninitialized" },
  { name: "vendor-b", path: "vendor/b", url: null, headOid: sha(5), status: "upToDate" },
  { name: "vendor-c", path: "vendor/c", url: null, headOid: sha(6), status: "modified" },
  { name: "vendor-d", path: "vendor/d", url: null, headOid: sha(7), status: "outOfDate" },
];

export const sampleWorktrees: WorktreeInfo[] = [
  {
    path: "/work/demo",
    branch: "main",
    head: sha(0),
    isMain: true,
    locked: false,
    prunable: false,
  },
  {
    path: "/work/demo-feature",
    branch: "feature",
    head: sha(1),
    isMain: false,
    locked: true,
    prunable: false,
  },
  { path: "/work/gone", branch: null, head: sha(2), isMain: false, locked: false, prunable: true },
];

export async function installHistoryBackend(): Promise<Commands> {
  const commands = (await installBackend()) as unknown as Commands;
  for (const name of EXTRA) commands[name] ??= vi.fn();
  commands.blame!.mockImplementation(() => ok(sampleBlame));
  commands.fileHistory!.mockImplementation(() => ok(sampleHistory));
  commands.reflog!.mockImplementation(() => ok(sampleReflog));
  commands.submoduleList!.mockImplementation(() => ok(sampleSubmodules));
  commands.submoduleUpdate!.mockImplementation(() => ok("op-submodule"));
  commands.worktreeList!.mockImplementation(() => ok(sampleWorktrees));
  commands.worktreeAdd!.mockImplementation((_r: string, req: { path: string; branch: string }) =>
    ok({
      path: req.path,
      branch: req.branch,
      head: sha(0),
      isMain: false,
      locked: false,
      prunable: false,
    }),
  );
  commands.worktreeRemove!.mockImplementation(() => ok(null));
  return commands;
}
