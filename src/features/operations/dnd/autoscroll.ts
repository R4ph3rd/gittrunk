const SCROLLERS = ['[role="grid"][aria-label="Commit graph"]', 'nav[aria-label="References"]'];
const EDGE = 48;
const MAX_SPEED = 18;

/**
 * Scrolls the graph list and the sidebar while a drag hovers near their top or bottom edge.
 * dnd-kit only scrolls ancestors of the dragged element, which misses cross-panel drags.
 * Returns a function that stops it.
 */
export function startAutoScroll(): () => void {
  let x = -1;
  let y = -1;
  let frame = 0;
  const onMove = (e: PointerEvent) => {
    x = e.clientX;
    y = e.clientY;
  };
  const tick = () => {
    for (const selector of SCROLLERS) {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const fromTop = y - r.top;
      const fromBottom = r.bottom - y;
      if (fromTop < EDGE) el.scrollTop -= Math.ceil(MAX_SPEED * (1 - fromTop / EDGE));
      else if (fromBottom < EDGE) el.scrollTop += Math.ceil(MAX_SPEED * (1 - fromBottom / EDGE));
    }
    frame = requestAnimationFrame(tick);
  };
  window.addEventListener("pointermove", onMove);
  frame = requestAnimationFrame(tick);
  return () => {
    window.removeEventListener("pointermove", onMove);
    cancelAnimationFrame(frame);
  };
}
