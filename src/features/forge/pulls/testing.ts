/* Test helpers for pull requests. Only imported from tests. */
import type { vi } from "vitest";
import { ok } from "@/app/mockBindings";
import type { ForgePull, ForgeTokenSource, PullBranch, PullDetail } from "@/ipc/bindings";
import { makeStatus } from "../testing";

export function makeBranch(name: string, parts: Partial<PullBranch> = {}): PullBranch {
  return {
    name,
    label: `acme:${name}`,
    sha: "a".repeat(40),
    repo: "acme/demo",
    isFork: false,
    ...parts,
  };
}

export function makePull(n: number, parts: Partial<ForgePull> = {}): ForgePull {
  return {
    number: n,
    title: `Pull title ${n}`,
    state: "open",
    draft: false,
    author: { login: "ada" },
    head: makeBranch(`feature-${n}`),
    base: makeBranch("main"),
    labels: [],
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    url: `https://github.com/acme/demo/pull/${n}`,
    ...parts,
  };
}

export function makePullDetail(n: number, parts: Partial<PullDetail> = {}): PullDetail {
  return {
    pull: makePull(n),
    body: "Pull body",
    comments: [],
    commits: 3,
    additions: 12,
    deletions: 4,
    changedFiles: 2,
    mergeable: true,
    ...parts,
  };
}

type Fn = ReturnType<typeof vi.fn>;
export type PullMocks = Record<
  | "forgeStatus"
  | "forgeTokenSource"
  | "forgePulls"
  | "forgePull"
  | "forgePullComment"
  | "avatarsGet",
  Fn
>;

/** A ready forge with `pulls` listed (filtered by state), details derived from them. */
export function pullsReady(
  commands: unknown,
  opts: { pulls?: ForgePull[]; token?: ForgeTokenSource; detail?: Partial<PullDetail> } = {},
): PullMocks {
  const c = commands as PullMocks;
  const pulls = opts.pulls ?? [makePull(1), makePull(2)];
  c.forgeStatus.mockImplementation(() => ok(makeStatus({ token: opts.token ?? "forge" })));
  c.forgeTokenSource.mockImplementation(() => ok(opts.token ?? "forge"));
  c.forgePulls.mockImplementation((_r: string, q: { state: string }) =>
    ok({
      items: pulls.filter(
        (p) => q.state === "all" || (q.state === "open") === (p.state === "open"),
      ),
      nextPage: null,
    }),
  );
  c.forgePull.mockImplementation((_r: string, n: number) =>
    ok(
      makePullDetail(n, { pull: pulls.find((p) => p.number === n) ?? makePull(n), ...opts.detail }),
    ),
  );
  c.forgePullComment.mockImplementation(() =>
    ok({
      id: "c1",
      author: { login: "grace" },
      body: "posted",
      createdAt: 1_700_000_100,
      url: "https://github.com/acme/demo/pull/1#issuecomment-1",
    }),
  );
  c.avatarsGet.mockImplementation((subjects: unknown[]) => ok(subjects.map(() => null)));
  return c;
}
