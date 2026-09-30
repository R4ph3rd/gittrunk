import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, useLayoutStore } from "./layout";

const stored = () => JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null");

const panels = (s: { sidebar: boolean; bottom: boolean; right: boolean }) => ({
  sidebar: s.sidebar,
  bottom: s.bottom,
  right: s.right,
});

describe("layout store", () => {
  beforeEach(() => useLayoutStore.getState().reset());

  it("starts with the defaults", () => {
    expect(panels(useLayoutStore.getState())).toEqual(DEFAULT_LAYOUT);
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
  });

  it("persists every change", () => {
    useLayoutStore.getState().toggle("bottom");
    expect(useLayoutStore.getState().bottom).toBe(true);
    expect(stored()).toEqual({ sidebar: true, bottom: true, right: true });
    useLayoutStore.getState().setVisible("sidebar", false);
    expect(stored()).toEqual({ sidebar: false, bottom: true, right: true });
  });

  it("reads corrupt storage as defaults", async () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, "{not json");
    vi.resetModules();
    const fresh = await import("./layout");
    expect(panels(fresh.useLayoutStore.getState())).toEqual(DEFAULT_LAYOUT);
  });

  it("restores a stored layout and ignores bad fields", async () => {
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({ sidebar: false, bottom: "yes", right: false }),
    );
    vi.resetModules();
    const fresh = await import("./layout");
    expect(panels(fresh.useLayoutStore.getState())).toEqual({
      sidebar: false,
      bottom: false,
      right: false,
    });
  });
});
