import { vi } from "vitest";

type Listener = (e: { payload: { repoId: string; scopes: string[] } }) => void;
const listeners = new Set<Listener>();

export const ok = <T>(data: T) => Promise.resolve({ status: "ok" as const, data });
export const fail = (kind: string, message: string) =>
  Promise.resolve({ status: "error" as const, error: { kind, message, detail: null } });

export const names = [
  "appInfo",
  "repoOpen",
  "repoClose",
  "repoInfo",
  "repoRecent",
  "graphLoad",
  "graphRows",
  "graphSearch",
  "commitDetails",
  "commitFileDiff",
  "refsList",
  "status",
  "worktreeFileDiff",
  "stagePaths",
  "unstagePaths",
  "discardPaths",
  "stageLines",
  "unstageLines",
  "discardLines",
  "commitCreate",
  "stashList",
  "stashSave",
  "stashApply",
  "stashDrop",
  "undo",
] as const;

/** Factory for `vi.mock("@/ipc/bindings", ...)`. */
export function bindingsMock() {
  const commands = Object.fromEntries(names.map((n) => [n, vi.fn()]));
  return {
    commands,
    events: {
      repoChanged: {
        listen: (cb: Listener) => {
          listeners.add(cb);
          return Promise.resolve(() => listeners.delete(cb));
        },
      },
    },
  };
}

export function emitRepoChanged(repoId: string, scopes: string[]) {
  for (const l of [...listeners]) l({ payload: { repoId, scopes } });
}
