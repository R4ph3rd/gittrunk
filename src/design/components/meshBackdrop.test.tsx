import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeshBackdrop } from "./MeshBackdrop";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const layers = (root: HTMLElement) => [
  ...root.querySelectorAll<SVGPathElement>("[data-wave-layer]"),
];
const paths = (root: HTMLElement) => layers(root).map((p) => p.getAttribute("d"));

function stubRaf() {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

const renderWith = (scroller: HTMLDivElement) =>
  render(<MeshBackdrop intensity="subtle" scrollRef={{ current: scroller }} />);

describe("MeshBackdrop", () => {
  it("renders a red-to-blue token gradient wave with the intensity variables", () => {
    const { getByTestId } = render(<MeshBackdrop intensity="page" />);
    const root = getByTestId("mesh-backdrop");
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).toHaveAttribute("data-intensity", "page");
    expect(root.className).toContain("pointer-events-none");
    const stops = [...root.querySelectorAll("stop")].map((s) => s.getAttribute("stop-color"));
    expect(stops).toEqual(["var(--backdrop-red)", "var(--backdrop-blue)"]);
    expect(root.querySelector<HTMLElement>("[data-wave]")!.style.filter).toBe(
      "blur(var(--backdrop-blur-page))",
    );
    const items = layers(root);
    expect(items).toHaveLength(2);
    items.forEach((el) => {
      expect(el.getAttribute("d")).toMatch(/^M .* Z$/);
      expect(el.getAttribute("fill")).toMatch(/^url\(#wave-/);
      expect(el.style.opacity).toContain("var(--backdrop-alpha-page)");
    });
  });

  it("morphs the wave on scroll through direct d writes", () => {
    stubRaf();
    const scroller = document.createElement("div");
    const { getByTestId } = renderWith(scroller);
    const root = getByTestId("mesh-backdrop");
    const before = paths(root);
    scroller.scrollTop = 700;
    fireEvent.scroll(scroller);
    const after = paths(root);
    after.forEach((d, i) => expect(d).not.toBe(before[i]));
  });

  it("stays static under prefers-reduced-motion", () => {
    stubRaf();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const scroller = document.createElement("div");
    const add = vi.spyOn(scroller, "addEventListener");
    const { getByTestId } = renderWith(scroller);
    const root = getByTestId("mesh-backdrop");
    const before = paths(root);
    scroller.scrollTop = 700;
    fireEvent.scroll(scroller);
    expect(paths(root)).toEqual(before);
    expect(add).not.toHaveBeenCalledWith("scroll", expect.anything(), expect.anything());
  });

  it("removes the scroll listener on unmount", () => {
    const scroller = document.createElement("div");
    const remove = vi.spyOn(scroller, "removeEventListener");
    const { unmount } = renderWith(scroller);
    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
