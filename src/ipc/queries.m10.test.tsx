import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());

import { fail, ok } from "@/app/mockBindings";
import { commands } from "@/ipc/bindings";
import {
  invalidateRepoLists,
  openUrl,
  queryKeys,
  useAddPullComment,
  useForgeNotifications,
  useForgetRepo,
  useGenerateSshKey,
  useKnownRepos,
  usePull,
  usePulls,
  useSshKeys,
} from "./queries";

const mock = (name: keyof typeof commands) => commands[name] as unknown as ReturnType<typeof vi.fn>;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

describe("M10 query keys", () => {
  it("has the documented shapes", () => {
    expect(queryKeys.known).toEqual(["repoKnown"]);
    expect(queryKeys.ssh).toEqual(["sshKeys"]);
    expect(queryKeys.forge.pulls("r1", "open")).toEqual(["forge", "r1", "pulls", "open"]);
    expect(queryKeys.forge.pull("r1", 4)).toEqual(["forge", "r1", "pull", 4]);
    expect(queryKeys.forge.notifications("github.com")).toEqual([
      "forge",
      "notifications",
      "github.com",
    ]);
  });
});

describe("known repositories", () => {
  beforeEach(() => {
    mock("repoKnown").mockReset();
    mock("repoForget").mockReset();
  });

  it("useKnownRepos calls repoKnown", async () => {
    const list = [{ path: "/a", name: "a", lastOpened: 1, exists: true }];
    mock("repoKnown").mockImplementation(() => ok(list));
    const { wrapper } = setup();
    const { result } = renderHook(() => useKnownRepos(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(list));
  });

  it("useForgetRepo calls repoForget and invalidates recent and known", async () => {
    mock("repoForget").mockImplementation(() => ok(null));
    const { client, wrapper } = setup();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useForgetRepo(), { wrapper });
    await act(() => result.current.mutateAsync("/a"));
    expect(mock("repoForget")).toHaveBeenCalledWith("/a");
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(queryKeys.recent);
    expect(keys).toContainEqual(queryKeys.known);
  });

  it("invalidateRepoLists marks both lists stale", async () => {
    const { client } = setup();
    client.setQueryData(queryKeys.recent, []);
    client.setQueryData(queryKeys.known, []);
    await invalidateRepoLists(client);
    expect(client.getQueryState(queryKeys.recent)?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.known)?.isInvalidated).toBe(true);
  });
});

describe("pull requests", () => {
  beforeEach(() => {
    for (const n of ["forgePulls", "forgePull", "forgePullComment"] as const) mock(n).mockReset();
  });

  it("usePulls pages like useIssues", async () => {
    mock("forgePulls").mockImplementation((_r: string, q: { page: number }) =>
      ok({ items: [], nextPage: q.page === 1 ? 2 : null }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => usePulls("r1", "open", { perPage: 10 }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mock("forgePulls")).toHaveBeenCalledWith("r1", { state: "open", page: 1, perPage: 10 });
    expect(result.current.hasNextPage).toBe(true);
    await act(() => result.current.fetchNextPage());
    expect(mock("forgePulls")).toHaveBeenLastCalledWith("r1", {
      state: "open",
      page: 2,
      perPage: 10,
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });

  it("usePulls defaults perPage to 30 and honours enabled", async () => {
    mock("forgePulls").mockImplementation(() => ok({ items: [], nextPage: null }));
    const { wrapper } = setup();
    renderHook(() => usePulls("r1", "all", { enabled: false }), { wrapper });
    expect(mock("forgePulls")).not.toHaveBeenCalled();
    renderHook(() => usePulls("r2", "closed"), { wrapper });
    await waitFor(() =>
      expect(mock("forgePulls")).toHaveBeenCalledWith("r2", {
        state: "closed",
        page: 1,
        perPage: 30,
      }),
    );
  });

  it("usePull is disabled for null and calls forgePull otherwise", async () => {
    mock("forgePull").mockImplementation(() => fail("notFound", "no"));
    const { wrapper } = setup();
    renderHook(() => usePull("r1", null), { wrapper });
    expect(mock("forgePull")).not.toHaveBeenCalled();
    renderHook(() => usePull("r1", 7), { wrapper });
    await waitFor(() => expect(mock("forgePull")).toHaveBeenCalledWith("r1", 7));
  });

  it("useAddPullComment posts and invalidates the pull and the list", async () => {
    mock("forgePullComment").mockImplementation(() => ok({ id: "1" }));
    const { client, wrapper } = setup();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useAddPullComment("r1", 7), { wrapper });
    await act(() => result.current.mutateAsync("hello"));
    expect(mock("forgePullComment")).toHaveBeenCalledWith("r1", 7, "hello");
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(queryKeys.forge.pull("r1", 7));
    expect(keys).toContainEqual(["forge", "r1", "pulls"]);
  });
});

describe("notifications, ssh and openUrl", () => {
  beforeEach(() => {
    for (const n of ["forgeNotifications", "sshKeysList", "sshKeyGenerate", "appOpenUrl"] as const)
      mock(n).mockReset();
  });

  it("useForgeNotifications calls forgeNotifications and honours enabled", async () => {
    mock("forgeNotifications").mockImplementation(() => ok([]));
    const { wrapper } = setup();
    renderHook(() => useForgeNotifications("github.com", { enabled: false }), { wrapper });
    expect(mock("forgeNotifications")).not.toHaveBeenCalled();
    const { result } = renderHook(() => useForgeNotifications("github.com"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(mock("forgeNotifications")).toHaveBeenCalledWith("github.com");
  });

  it("useSshKeys lists keys and can be disabled", async () => {
    const list = { dir: "/h/.ssh", keys: [] };
    mock("sshKeysList").mockImplementation(() => ok(list));
    const { wrapper } = setup();
    renderHook(() => useSshKeys(false), { wrapper });
    expect(mock("sshKeysList")).not.toHaveBeenCalled();
    const { result } = renderHook(() => useSshKeys(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(list));
  });

  it("useGenerateSshKey sends the request and invalidates ssh", async () => {
    mock("sshKeyGenerate").mockImplementation(() => ok({ name: "k" }));
    const { client, wrapper } = setup();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useGenerateSshKey(), { wrapper });
    const req = { name: "id_x", comment: "me", passphrase: null };
    await act(() => result.current.mutateAsync(req));
    expect(mock("sshKeyGenerate")).toHaveBeenCalledWith(req);
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(queryKeys.ssh);
  });

  it("openUrl resolves on success and throws on refusal", async () => {
    mock("appOpenUrl").mockImplementation(() => ok(null));
    await expect(openUrl("https://github.com/a/b")).resolves.toBeUndefined();
    expect(mock("appOpenUrl")).toHaveBeenCalledWith("https://github.com/a/b");
    mock("appOpenUrl").mockImplementation(() => fail("invalidInput", "refused"));
    await expect(openUrl("http://evil")).rejects.toThrow("refused");
  });
});
