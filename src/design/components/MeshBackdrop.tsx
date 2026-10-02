import type { RefObject } from "react";
import { cn } from "@/lib/cn";

export interface MeshBackdropProps {
  /** "subtle": behind dense content such as the graph. "page": the Home page. */
  intensity: "subtle" | "page";
  /** Scroll container driving the parallax; omit for a static backdrop. */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Change it when the scroll element is replaced so the listener re-subscribes. */
  scrollKey?: string | number;
  className?: string;
}

/** Decorative blurred blobs. Place as the first child of a `relative isolate` container. */
export function MeshBackdrop({ intensity, className }: MeshBackdropProps) {
  return (
    <div
      aria-hidden
      data-testid="mesh-backdrop"
      data-intensity={intensity}
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    />
  );
}
