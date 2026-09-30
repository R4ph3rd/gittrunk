import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setViewport } from "../../test/viewport";
import { dispatchBack, installBackButton, pushBackHandler } from "./back";
import { LayoutProvider } from "./LayoutProvider";
import { COARSE_QUERY, COMPACT_QUERY, SHORT_QUERY } from "./queries";
import { useBackHandler } from "./useBackHandler";
import { useLayout } from "./useLayout";

describe("css sync", () => {
  it("keeps the query strings verbatim in index.css", async () => {
    // vitest stubs CSS imports (even ?raw), so read the file directly.
    const fs = await vi.importActual<{ readFileSync(path: string, enc: "utf8"): string }>(
      "node:fs",
    );
    const css = fs.readFileSync("src/index.css", "utf8");
    expect(css).toContain(COMPACT_QUERY);
    expect(css).toContain(SHORT_QUERY);
    expect(css).toContain(COARSE_QUERY);
  });
});

describe("useLayout", () => {
  it("is regular without matchMedia", () => {
    const { result } = renderHook(() => useLayout());
    expect(result.current).toEqual({
      mode: "regular",
      isCompact: false,
      isShort: false,
      isCoarse: false,
    });
  });

  it("phone portrait is compact and coarse, not short", () => {
    setViewport(390, 844);
    const { result } = renderHook(() => useLayout());
    expect(result.current).toEqual({
      mode: "compact",
      isCompact: true,
      isShort: false,
      isCoarse: true,
    });
  });

  it("phone landscape is compact and short", () => {
    setViewport(844, 390);
    const { result } = renderHook(() => useLayout());
    expect(result.current.isCompact).toBe(true);
    expect(result.current.isShort).toBe(true);
  });

  it("desktop is regular and fine", () => {
    setViewport(1400, 900);
    const { result } = renderHook(() => useLayout());
    expect(result.current.mode).toBe("regular");
    expect(result.current.isCoarse).toBe(false);
  });

  it("tablet is regular", () => {
    setViewport(800, 1280);
    const { result } = renderHook(() => useLayout());
    expect(result.current.mode).toBe("regular");
    expect(result.current.isCompact).toBe(false);
  });

  it("re-renders a consumer on live resize", () => {
    setViewport(1400, 900);
    function Probe() {
      return <div data-testid="mode">{useLayout().mode}</div>;
    }
    render(<Probe />);
    expect(screen.getByTestId("mode")).toHaveTextContent("regular");
    act(() => setViewport(390, 844));
    expect(screen.getByTestId("mode")).toHaveTextContent("compact");
    act(() => setViewport(1400, 900));
    expect(screen.getByTestId("mode")).toHaveTextContent("regular");
  });

  it("LayoutProvider force overrides fields", () => {
    const { result } = renderHook(() => useLayout(), {
      wrapper: ({ children }) => (
        <LayoutProvider force={{ isCompact: true }}>{children}</LayoutProvider>
      ),
    });
    expect(result.current.mode).toBe("compact");
    expect(result.current.isCompact).toBe(true);
  });
});

describe("back stack", () => {
  it("dispatches LIFO and stops at the first handler that handles", () => {
    const calls: string[] = [];
    pushBackHandler(() => (calls.push("base"), true));
    pushBackHandler(() => (calls.push("top-declines"), false));
    const off = pushBackHandler(() => (calls.push("top"), true));
    expect(dispatchBack()).toBe(true);
    expect(calls).toEqual(["top"]);
    off();
    calls.length = 0;
    expect(dispatchBack()).toBe(true);
    expect(calls).toEqual(["top-declines", "base"]);
  });

  it("returns false when nothing handles", () => {
    expect(dispatchBack()).toBe(false);
    pushBackHandler(() => false);
    expect(dispatchBack()).toBe(false);
  });

  it("useBackHandler respects enabled and uses the latest handler", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const { rerender } = renderHook(({ h, on }) => useBackHandler(h, on), {
      initialProps: { h: first, on: false },
    });
    expect(dispatchBack()).toBe(false);
    rerender({ h: first, on: true });
    expect(dispatchBack()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    rerender({ h: second, on: true });
    dispatchBack();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    rerender({ h: second, on: false });
    expect(dispatchBack()).toBe(false);
  });

  it("installBackButton re-pushes the sentinel only when handled", () => {
    const push = vi.spyOn(window.history, "pushState");
    const cleanup = installBackButton();
    expect(push).toHaveBeenCalledTimes(1);
    expect(installBackButton()).toBe(cleanup);
    expect(push).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(push).toHaveBeenCalledTimes(1);

    const off = pushBackHandler(() => true);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(push).toHaveBeenCalledTimes(2);

    off();
    cleanup();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(push).toHaveBeenCalledTimes(2);
    push.mockRestore();
  });
});
