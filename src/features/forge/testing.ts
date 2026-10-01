/* Test helpers for the forge feature. Only imported from tests. */
import { createElement, type ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { ok } from "@/app/mockBindings";
import { TooltipProvider } from "@/design/components";
import type {
  ForgeComment,
  ForgeStatus,
  ForgeTokenSource,
  Issue,
  IssueDetail,
} from "@/ipc/bindings";

export function makeIssue(n: number, parts: Partial<Issue> = {}): Issue {
  return {
    number: n,
    title: `Issue title ${n}`,
    state: "open",
    author: { login: "ada" },
    labels: [],
    comments: 0,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    url: `https://github.com/acme/demo/issues/${n}`,
    ...parts,
  };
}

export function makeComment(id: string, body: string, login = "grace"): ForgeComment {
  return {
    id,
    author: { login },
    body,
    createdAt: 1_700_000_100,
    url: `https://github.com/acme/demo/issues/1#issuecomment-${id}`,
  };
}

export function makeStatus(
  parts: { kind?: "github" | "gitlab"; supported?: boolean; token?: ForgeTokenSource } = {},
): ForgeStatus {
  return {
    repo: {
      kind: parts.kind ?? "github",
      host: parts.kind === "gitlab" ? "gitlab.com" : "github.com",
      owner: "acme",
      name: "demo",
      webUrl: "https://github.com/acme/demo",
      remote: "origin",
    },
    supported: parts.supported ?? true,
    tokenSource: parts.token ?? "forge",
  };
}

type Fn = ReturnType<typeof vi.fn>;
export type ForgeMocks = Record<
  | "forgeStatus"
  | "forgeTokenSource"
  | "forgeTokenSet"
  | "forgeTokenClear"
  | "forgeIssues"
  | "forgeIssue"
  | "forgeIssueCreate"
  | "forgeIssueComment"
  | "forgeCommitComments"
  | "forgeCommitComment"
  | "avatarsGet",
  Fn
>;

/** A ready forge: GitHub origin, a token, `issues` listed, empty comments. */
export function forgeReady(
  commands: unknown,
  opts: { issues?: Issue[]; token?: ForgeTokenSource; detail?: Partial<IssueDetail> } = {},
): ForgeMocks {
  const c = commands as ForgeMocks;
  const issues = opts.issues ?? [makeIssue(1), makeIssue(2)];
  c.forgeStatus.mockImplementation(() => ok(makeStatus({ token: opts.token ?? "forge" })));
  c.forgeTokenSource.mockImplementation(() => ok(opts.token ?? "forge"));
  c.forgeIssues.mockImplementation(() => ok({ items: issues, nextPage: null }));
  c.forgeIssue.mockImplementation((_repo: string, n: number) =>
    ok({
      issue: issues.find((i) => i.number === n) ?? makeIssue(n),
      body: "Issue body",
      comments: [],
      ...opts.detail,
    }),
  );
  c.forgeIssueCreate.mockImplementation((_r: string, req: { title: string }) =>
    ok(makeIssue(99, { title: req.title })),
  );
  c.forgeIssueComment.mockImplementation(() => ok(makeComment("c1", "posted")));
  c.forgeCommitComments.mockImplementation(() => ok([]));
  c.forgeCommitComment.mockImplementation(() => ok(makeComment("c2", "posted")));
  c.avatarsGet.mockImplementation((subjects: unknown[]) => ok(subjects.map(() => null)));
  return c;
}

export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const wrap = (el: ReactElement) =>
    createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, el));
  const result = render(wrap(ui));
  return { client, ...result };
}
