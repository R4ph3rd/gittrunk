/* Test helpers: a mocked backend contract and DOM shims for jsdom. Only imported from tests. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { CommitDetails, GraphRow, RepoInfo } from "@/ipc/bindings";
import { useRepoStore } from "@/stores/repo";
import { App } from "./App";

import { emitRepoChanged, fail, names, ok } from "./mockBindings";

export { emitRepoChanged, fail, ok };

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

type Mocked = Record<(typeof names)[number], ReturnType<typeof vi.fn>>;

/** Installs default implementations on the mocked commands. */
export async function installBackend(rowCount = 1000, searchHits: number[] = []) {
  const { commands } = (await import("@/ipc/bindings")) as unknown as { commands: Mocked };
  commands.appInfo.mockImplementation(() =>
    ok({ version: "0.1.0", gitVersion: "git version 2.45.0", platform: "windows" }),
  );
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
  commands.status.mockImplementation(() =>
    ok({ state: "clean", staged: [], unstaged: [], conflicted: [] }),
  );
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
    get: () => () => undefined,
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() =>
    ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

export function resetStore() {
  useRepoStore.setState({
    repos: [],
    activeId: null,
    selectedOid: {},
    filters: {},
    openError: null,
  });
}

export function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  return { client, ...view };
}
