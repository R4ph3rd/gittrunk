import { vi } from "vitest";

/** A minimal stand-in for a generated event: `listen` registers, `emitMock` delivers. */
function eventMock<T>() {
  const set = new Set<(e: { payload: T }) => void>();
  return {
    listen: (cb: (e: { payload: T }) => void) => {
      set.add(cb);
      return Promise.resolve(() => set.delete(cb));
    },
    emitMock: (payload: T) => {
      for (const l of [...set]) l({ payload });
    },
  };
}

const repoChanged = eventMock<{ repoId: string; scopes: string[] }>();
const opProgress = eventMock<{
  opId: string;
  phase: string;
  percent: number | null;
  message: string | null;
}>();
const opFinished = eventMock<{ opId: string; outcome: unknown; error: unknown }>();
const credentialRequested = eventMock<{
  requestId: string;
  url: string;
  username: string | null;
  kind: "username" | "password" | "passphrase";
}>();
export const ok = <T>(data: T) => Promise.resolve({ status: "ok" as const, data });
export const fail = (kind: string, message: string) =>
  Promise.resolve({ status: "error" as const, error: { kind, message, detail: null } });

export const names = [
  "appInfo",
  "settingsGet",
  "settingsSet",
  "keybindingsGet",
  "keybindingsSet",
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
  "checkout",
  "branchDelete",
  "remoteList",
  "remoteAdd",
  "remoteRemove",
  "remoteRename",
  "remoteSetUrl",
  "fetch",
  "pull",
  "push",
  "repoClone",
  "setUpstream",
  "opCancel",
  "credentialRespond",
  "credentialStore",
  "credentialClear",
] as const;

/** Factory for `vi.mock("@/ipc/bindings", ...)`. */
export function bindingsMock() {
  const commands = Object.fromEntries(names.map((n) => [n, vi.fn()]));
  return {
    commands,
    events: { repoChanged, opProgress, opFinished, credentialRequested },
  };
}

export function emitRepoChanged(repoId: string, scopes: string[]) {
  repoChanged.emitMock({ repoId, scopes });
}

export const emitOpProgress = (
  opId: string,
  phase: string,
  percent: number | null = null,
  message: string | null = null,
) => opProgress.emitMock({ opId, phase, percent, message });

export const emitOpFinished = (opId: string, result: { outcome?: unknown; error?: unknown } = {}) =>
  opFinished.emitMock({ opId, outcome: result.outcome ?? null, error: result.error ?? null });

export const emitCredentialRequested = (
  requestId: string,
  kind: "username" | "password" | "passphrase" = "password",
  url = "https://github.com/acme/demo.git",
  username: string | null = null,
) => credentialRequested.emitMock({ requestId, url, username, kind });
