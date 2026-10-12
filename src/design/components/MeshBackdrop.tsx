import { useEffect, useId, useRef, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { WAVE_LAYERS, wavePath } from "../mesh";

export interface MeshBackdropProps {
  /** "subtle": behind dense content such as the graph. "page": the Home page. */
  intensity: "subtle" | "page";
  /** Scroll container whose position morphs the wave; omit for a static backdrop. */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Change it when the scroll element is replaced so the listener re-subscribes. */
  scrollKey?: string | number;
  className?: string;
}

const MASK = "linear-gradient(to top, #000 0%, #000 26%, transparent 62%)";

/** Decorative soft wave rising from the bottom (red left, blue right). Place as the first child of a `relative isolate` container. */
export function MeshBackdrop({ intensity, scrollRef, scrollKey, className }: MeshBackdropProps) {
  const reduced = usePrefersReducedMotion();
  const gradientId = `wave-${useId().replace(/:/g, "")}`;
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);

  useEffect(() => {
    const apply = (scrollTop: number) => {
      pathRefs.current.forEach((el, i) => {
        if (el) el.setAttribute("d", wavePath(scrollTop, WAVE_LAYERS[i]!));
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
      <div
        data-wave
        className="absolute inset-0"
        style={{
          filter: `blur(var(--backdrop-blur-${intensity}))`,
          maskImage: MASK,
          WebkitMaskImage: MASK,
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="size-full overflow-visible"
          focusable="false"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--backdrop-red)" />
              <stop offset="1" stopColor="var(--backdrop-blue)" />
            </linearGradient>
          </defs>
          {WAVE_LAYERS.map((layer, i) => (
            <path
              key={i}
              ref={(node) => {
                pathRefs.current[i] = node;
              }}
              data-wave-layer={i}
              d={wavePath(0, layer)}
              fill={`url(#${gradientId})`}
              style={{ opacity: `calc(var(--backdrop-alpha-${intensity}) * ${layer.weight})` }}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
