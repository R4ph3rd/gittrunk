import { useEffect, useMemo, useRef, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { BLOBS, blobOffset, blobPath } from "../mesh";

export interface MeshBackdropProps {
  /** "subtle": behind dense content such as the graph. "page": the Home page. */
  intensity: "subtle" | "page";
  /** Scroll container driving the parallax; omit for a static backdrop. */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Change it when the scroll element is replaced so the listener re-subscribes. */
  scrollKey?: string | number;
  className?: string;
}

const transformAt = (scrollTop: number, i: number) => {
  const { x, y } = blobOffset(scrollTop, BLOBS[i]!);
  return `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
};

/** Decorative blurred blobs. Place as the first child of a `relative isolate` container. */
export function MeshBackdrop({ intensity, scrollRef, scrollKey, className }: MeshBackdropProps) {
  const reduced = usePrefersReducedMotion();
  const blobRefs = useRef<(HTMLDivElement | null)[]>([]);
  const paths = useMemo(() => BLOBS.map((b) => blobPath(b.seed)), []);

  useEffect(() => {
    const apply = (scrollTop: number) => {
      blobRefs.current.forEach((el, i) => {
        if (el) el.style.transform = transformAt(scrollTop, i);
      });
    };
    const el = scrollRef?.current;
    if (!el || reduced) {
      apply(0);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      apply(el.scrollTop);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    apply(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollRef, scrollKey, reduced]);

  return (
    <div
      aria-hidden
      data-testid="mesh-backdrop"
      data-intensity={intensity}
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {BLOBS.map((b, i) => (
        <div
          key={b.color}
          ref={(node) => {
            blobRefs.current[i] = node;
          }}
          data-blob={b.color}
          className="absolute will-change-transform"
          style={{
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: `${b.size}%`,
            height: `${b.size}%`,
            opacity: `var(--backdrop-alpha-${intensity})`,
            filter: `blur(var(--backdrop-blur-${intensity}))`,
            transform: transformAt(0, i),
          }}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="size-full"
            focusable="false"
          >
            <path d={paths[i]} fill={`var(--backdrop-${b.color})`} />
          </svg>
        </div>
      ))}
    </div>
  );
}
