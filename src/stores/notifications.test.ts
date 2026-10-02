import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { RepoInfo } from "@/ipc/bindings";
import { MAX_NOTIFICATIONS, useNotificationsStore, useUnreadNotifications } from "./notifications";
import { useRepoStore } from "./repo";

const store = () => useNotificationsStore.getState();

const repo: RepoInfo = {
  id: "r1",
  path: "/work/demo",
  name: "demo",
  head: { kind: "detached", oid: "0".repeat(40) },
  state: "clean",
  isBare: false,
};

describe("notifications store", () => {
  beforeEach(() => {
    store().reset();
    useRepoStore.setState({ repos: [], activeId: null });
  });

  it("pushes newest first with defaults", () => {
    store().push({ level: "info", title: "one" });
    store().push({ level: "error", title: "two", detail: "boom" });
    const [two, one] = store().items;
    expect(two).toMatchObject({ title: "two", level: "error", detail: "boom", read: false });
    expect(one).toMatchObject({ title: "one", detail: null, source: null, read: false });
    expect(two?.id).toMatch(/^n-\d+$/);
    expect(two?.id).not.toBe(one?.id);
    expect(typeof two?.at).toBe("number");
  });

  it("records the active repository name as source", () => {
    useRepoStore.setState({ repos: [repo], activeId: "r1" });
    store().push({ level: "success", title: "done" });
    expect(store().items[0]?.source).toBe("demo");
  });

  it("keeps at most MAX_NOTIFICATIONS, dropping the oldest", () => {
    for (let i = 0; i < MAX_NOTIFICATIONS + 5; i++) store().push({ level: "info", title: `t${i}` });
    expect(store().items).toHaveLength(MAX_NOTIFICATIONS);
    expect(store().items[0]?.title).toBe(`t${MAX_NOTIFICATIONS + 4}`);
    expect(store().items.at(-1)?.title).toBe("t5");
  });

  it("counts unread, marks all read, clears and resets", () => {
    const { result } = renderHook(() => useUnreadNotifications());
    expect(result.current).toBe(0);
    act(() => {
      store().push({ level: "warning", title: "a" });
      store().push({ level: "info", title: "b" });
    });
    expect(result.current).toBe(2);
    act(() => store().markAllRead());
    expect(result.current).toBe(0);
    expect(store().items).toHaveLength(2);
    act(() => store().push({ level: "info", title: "c" }));
    expect(result.current).toBe(1);
    act(() => store().clear());
    expect(store().items).toEqual([]);
    act(() => {
      store().push({ level: "info", title: "d" });
      store().reset();
    });
    expect(store().items).toEqual([]);
  });
});
