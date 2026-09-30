/* Test helpers for the operations feature. Only imported from tests. */
import { vi } from "vitest";
import { EditorView } from "codemirror";
import { installBackend, makeStatus, change, ok, oid, repoInfo, applied } from "@/app/testing";
import type {
  ConflictFile,
  OpOutcome,
  RebaseTodoItem,
  RepoInfo,
  StatusSnapshot,
} from "@/ipc/bindings";

type Fn = ReturnType<typeof vi.fn>;
type Commands = Record<string, Fn>;

/** Commands the shared mock does not know about yet are added here (it is owned elsewhere). */
const EXTRA = [
  "conflictList",
  "conflictFile",
  "conflictResolve",
  "sequencerControl",
  "rebaseTodoLoad",
  "rebaseInteractive",
] as const;

export const TWO_WAY = [
  "top",
  "<<<<<<< HEAD",
  "ours line",
  "=======",
  "theirs line",
  ">>>>>>> feature",
  "middle",
  "<<<<<<< HEAD",
  "ours two",
  "=======",
  "theirs two",
  ">>>>>>> feature",
  "bottom",
].join("\n");

export function conflictFile(over: Partial<ConflictFile> = {}): ConflictFile {
  return {
    path: "src/a.ts",
    binary: false,
    base: "top\nbase line\nmiddle\nbase two\nbottom",
    ours: "top\nours line\nmiddle\nours two\nbottom",
    theirs: "top\ntheirs line\nmiddle\ntheirs two\nbottom",
    merged: TWO_WAY,
    oursLabel: "HEAD",
    theirsLabel: "feature",
    ...over,
  };
}

export function todoItem(i: number, over: Partial<RebaseTodoItem> = {}): RebaseTodoItem {
  return { action: "pick", oid: oid(i), summary: `Commit number ${i}`, message: null, ...over };
}

export interface OpsBackend {
  commands: Commands;
  /** Sets the in-progress operation and the conflicted files the mocked backend reports. */
  setOperation: (state: RepoInfo["state"], conflicted?: string[]) => void;
}

export async function installOpsBackend(): Promise<OpsBackend> {
  const commands = (await installBackend()) as unknown as Commands;
  for (const name of EXTRA) commands[name] ??= vi.fn();
  let current: { state: RepoInfo["state"]; conflicted: string[] } = {
    state: "clean",
    conflicted: [],
  };
  const snapshot = (): StatusSnapshot =>
    makeStatus({
      state: current.state,
      conflicted: current.conflicted.map((p) => change(p, "conflicted")),
    });
  commands.repoInfo!.mockImplementation(() => ok({ ...repoInfo, state: current.state }));
  commands.status!.mockImplementation(() => ok(snapshot()));
  commands.conflictList!.mockImplementation(() => ok(snapshot().conflicted));
  commands.conflictFile!.mockImplementation((_r: string, path: string) =>
    ok(conflictFile({ path })),
  );
  commands.conflictResolve!.mockImplementation((_r: string, path: string) => {
    current = { ...current, conflicted: current.conflicted.filter((p) => p !== path) };
    return ok(null);
  });
  commands.sequencerControl!.mockImplementation((): Promise<unknown> =>
    ok<OpOutcome>(applied("Done")),
  );
  commands.rebaseTodoLoad!.mockImplementation(() => ok([todoItem(3), todoItem(2), todoItem(1)]));
  commands.rebaseInteractive!.mockImplementation((_r: string, _req: unknown, dryRun: boolean) =>
    ok<OpOutcome>(
      dryRun
        ? {
            kind: "preview",
            preview: {
              summary: "Rebase 3 commits",
              refUpdates: [],
              commitsCreated: 2,
              commitsDropped: [],
              predictedConflicts: ["src/a.ts"],
              warnings: [],
            },
          }
        : applied("Rebased"),
    ),
  );
  return {
    commands,
    setOperation: (state, conflicted = []) => {
      current = { state, conflicted };
    },
  };
}

/** CodeMirror measures text with Range rects, which jsdom does not implement. */
export function installCodeMirrorShims() {
  const rect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  });
  const list = () => Object.assign([] as unknown[], { item: () => null });
  Range.prototype.getBoundingClientRect = rect;
  Range.prototype.getClientRects = list as unknown as typeof Range.prototype.getClientRects;
  Element.prototype.scrollIntoView ??= () => undefined;
}

/** The CodeMirror view inside an element (e.g. the result pane). */
export function viewIn(container: Element): EditorView {
  const dom = container.querySelector<HTMLElement>(".cm-editor");
  const view = dom && EditorView.findFromDOM(dom);
  if (!view) throw new Error("no CodeMirror view found");
  return view;
}
