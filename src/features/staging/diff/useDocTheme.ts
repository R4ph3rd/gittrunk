import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const snapshot = (): "light" | "dark" =>
  document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";

/** The resolved theme from `<html data-theme>` (works without a ThemeProvider, e.g. in tests). */
export function useDocTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, snapshot, () => "dark");
}
