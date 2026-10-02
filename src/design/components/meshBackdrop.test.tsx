import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeshBackdrop } from "./MeshBackdrop";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const blobs = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-blob]")];
const transforms = (root: HTMLElement) => blobs(root).map((b) => b.style.transform);

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
  it("renders three token-colored blobs with the intensity variables", () => {
    const { getByTestId } = render(<MeshBackdrop intensity="page" />);
    const root = getByTestId("mesh-backdrop");
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).toHaveAttribute("data-intensity", "page");
    expect(root.className).toContain("pointer-events-none");
    const items = blobs(root);
    expect(items).toHaveLength(3);
    items.forEach((el, i) => {
      expect(el.style.opacity).toBe("var(--backdrop-alpha-page)");
      expect(el.style.filter).toBe("blur(var(--backdrop-blur-page))");
      expect(el.querySelector("path")).toHaveAttribute("fill", `var(--backdrop-${i + 1})`);
    });
  });

  it("moves the blobs on scroll through direct transform writes", () => {
    stubRaf();
    const scroller = document.createElement("div");
    const { getByTestId } = renderWith(scroller);
    const root = getByTestId("mesh-backdrop");
    const before = transforms(root);
    scroller.scrollTop = 700;
    fireEvent.scroll(scroller);
    const after = transforms(root);
    expect(after).not.toEqual(before);
    after.forEach((t) => expect(t).toMatch(/^translate3d\(/));
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
    const before = transforms(root);
    scroller.scrollTop = 700;
    fireEvent.scroll(scroller);
    expect(transforms(root)).toEqual(before);
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
