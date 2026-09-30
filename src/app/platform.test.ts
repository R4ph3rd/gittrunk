import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ipc/bindings", async () => (await import("./mockBindings")).bindingsMock());

import { commands } from "@/ipc/bindings";
import { fail, ok } from "./mockBindings";
import { ANDROID_PLATFORM, DESKTOP_PLATFORM, fallbackPlatform, usePlatform } from "./platform";

const platformInfo = commands.platformInfo as unknown as ReturnType<typeof vi.fn>;

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("fallbackPlatform", () => {
  it("detects Android from the user agent", () => {
    expect(fallbackPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe(ANDROID_PLATFORM);
  });

  it("defaults to desktop", () => {
    expect(fallbackPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe(DESKTOP_PLATFORM);
    expect(fallbackPlatform()).toBe(DESKTOP_PLATFORM);
  });
});

describe("capability flags", () => {
  it("desktop can write and has a terminal, Android is read-only without one", () => {
    expect([DESKTOP_PLATFORM.readOnly, DESKTOP_PLATFORM.supportsTerminal]).toEqual([false, true]);
    expect([ANDROID_PLATFORM.readOnly, ANDROID_PLATFORM.supportsTerminal]).toEqual([true, false]);
  });
});

describe("usePlatform", () => {
  beforeEach(() => platformInfo.mockReset());

  it("returns the fallback first, then the backend answer", async () => {
    platformInfo.mockImplementation(() =>
      ok({ ...ANDROID_PLATFORM, defaultReposDir: "/data/repos" }),
    );
    const { result } = renderHook(() => usePlatform(), { wrapper: wrapper() });
    expect(result.current).toEqual(DESKTOP_PLATFORM);
    await waitFor(() => expect(result.current.defaultReposDir).toBe("/data/repos"));
    expect(result.current.mobile).toBe(true);
  });

  it("keeps the fallback when the backend fails", async () => {
    platformInfo.mockImplementation(() => fail("internal", "boom"));
    const { result } = renderHook(() => usePlatform(), { wrapper: wrapper() });
    await waitFor(() => expect(platformInfo).toHaveBeenCalled());
    expect(result.current).toEqual(DESKTOP_PLATFORM);
  });
});
