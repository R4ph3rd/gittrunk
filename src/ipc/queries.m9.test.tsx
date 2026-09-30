import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ipc/bindings", async () => (await import("@/app/mockBindings")).bindingsMock());

import { emitRepoChanged, fail, ok } from "@/app/mockBindings";
import { commands } from "@/ipc/bindings";
import {
  avatarKey,
  fetchAvatars,
  queryKeys,
  useAvatar,
  useOplogState,
  useRefColors,
  useRepoEvents,
} from "./queries";

const mock = (name: keyof typeof commands) => commands[name] as unknown as ReturnType<typeof vi.fn>;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

const email = (e: string) => ({ kind: "email" as const, email: e });

describe("avatarKey", () => {
  it("normalises subjects", () => {
    expect(avatarKey(email("  Ada@Example.COM "))).toBe("email:ada@example.com");
    expect(avatarKey({ kind: "githubLogin", login: "OctoCat" })).toBe("github:octocat");
  });
});

describe("avatars", () => {
  beforeEach(() => {
    mock("avatarsGet").mockReset();
    mock("avatarsGet").mockImplementation((subjects: unknown[]) =>
      ok(subjects.map((_, i) => `data:image/png;base64,AA${i}`)),
    );
  });

  it("batches useAvatar calls made in the same tick into one request", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => [useAvatar(email("a@x.io")), useAvatar(email("b@x.io")), useAvatar(email("a@x.io"))],
      { wrapper },
    );
    await waitFor(() => expect(result.current[0]).not.toBeNull());
    expect(mock("avatarsGet")).toHaveBeenCalledTimes(1);
    expect(mock("avatarsGet").mock.calls[0]?.[0]).toHaveLength(2);
    expect(mock("avatarsGet").mock.calls[0]?.[1]).toBe(64);
    expect(result.current[1]).toMatch(/^data:image/);
  });

  it("does not re-request cached keys", async () => {
    const { client } = setup();
    client.setQueryData(queryKeys.avatar("email:a@x.io", 64), "data:image/png;base64,CACHED");
    const got = await fetchAvatars(client, [email("A@x.io"), email("b@x.io")]);
    expect(got.get("email:a@x.io")).toBe("data:image/png;base64,CACHED");
    expect(got.get("email:b@x.io")).toMatch(/^data:image/);
    expect(mock("avatarsGet")).toHaveBeenCalledTimes(1);
    expect(mock("avatarsGet").mock.calls[0]?.[0]).toEqual([email("b@x.io")]);
    expect(client.getQueryData(queryKeys.avatar("email:b@x.io", 64))).toMatch(/^data:image/);

    await fetchAvatars(client, [email("a@x.io"), email("b@x.io")]);
    expect(mock("avatarsGet")).toHaveBeenCalledTimes(1);
  });

  it("chunks by 100 and does not cache failures", async () => {
    const { client } = setup();
    const many = Array.from({ length: 250 }, (_, i) => email(`u${i}@x.io`));
    await fetchAvatars(client, many);
    expect(mock("avatarsGet")).toHaveBeenCalledTimes(3);

    mock("avatarsGet").mockImplementation(() => fail("network", "offline"));
    const got = await fetchAvatars(client, [email("z@x.io")]);
    expect(got.get("email:z@x.io")).toBeNull();
    expect(client.getQueryData(queryKeys.avatar("email:z@x.io", 64))).toBeUndefined();
  });
});

describe("useRefColors", () => {
  it("builds a map from the graph meta", async () => {
    mock("graphLoad").mockImplementation(() =>
      ok({
        rowCount: 2,
        laneCount: 2,
        headRow: 0,
        refColors: [
          { fullName: "refs/heads/main", color: 0 },
          { fullName: "refs/heads/dev", color: 3 },
        ],
      }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useRefColors("r1"), { wrapper });
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get("refs/heads/dev")).toBe(3);
  });

  it("stays empty without a repo", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRefColors(null), { wrapper });
    expect(result.current.size).toBe(0);
  });
});

describe("oplog state", () => {
  it("is refetched by a refs change", async () => {
    mock("oplogState").mockReset();
    mock("oplogState").mockImplementation(() =>
      ok({ canUndo: true, canRedo: false, undoDescription: "Commit", redoDescription: null }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(
      () => {
        useRepoEvents("r1");
        return useOplogState("r1");
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.canUndo).toBe(true));
    expect(mock("oplogState")).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      emitRepoChanged("r1", ["refs"]);
    });
    await waitFor(() => expect(mock("oplogState")).toHaveBeenCalledTimes(2));
  });
});
