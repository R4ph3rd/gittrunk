export type BackHandler = () => boolean;

const stack: BackHandler[] = [];
const SENTINEL = { gittrunkBack: true };

let installed: (() => void) | null = null;

/** LIFO. Returns an unregister function. */
export function pushBackHandler(handler: BackHandler): () => void {
  const entry: BackHandler = () => handler();
  stack.push(entry);
  return () => {
    const i = stack.lastIndexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Calls handlers top-down until one returns true. */
export function dispatchBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]?.()) return true;
  }
  return false;
}

function pushSentinel() {
  window.history.pushState(SENTINEL, "");
}

/**
 * Pushes a sentinel history entry; on popstate runs dispatchBack() and re-pushes the
 * sentinel only when handled, so an unhandled back leaves the page. Idempotent.
 */
export function installBackButton(): () => void {
  if (installed) return installed;
  const onPop = () => {
    if (dispatchBack()) pushSentinel();
  };
  pushSentinel();
  window.addEventListener("popstate", onPop);
  const cleanup = () => {
    window.removeEventListener("popstate", onPop);
    if (installed === cleanup) installed = null;
  };
  installed = cleanup;
  return cleanup;
}

export function resetBackStackForTests(): void {
  stack.length = 0;
  installed?.();
  installed = null;
}
