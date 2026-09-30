import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/design/components";
import { commands } from "@/ipc/bindings";
import { queryKeys } from "@/ipc/queries";
import { NO_REPO, useNavStore } from "@/stores/nav";
import { useRepoStore } from "@/stores/repo";
import { usePlatform } from "@/app/platform";
import { installBackButton, pushBackHandler } from "./back";

/** Second back press within this window exits the app. */
export const EXIT_WINDOW_MS = 2000;
/** Minimum gap between resume refetches. */
export const RESUME_THROTTLE_MS = 2000;

/** True for elements that open the soft keyboard. */
export function isTextField(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"].includes(
    el.type,
  );
}

/**
 * Base back handler: pop the stack, else go to History, else "press back again to exit".
 * Overlays register above it, so they close first.
 */
export function createBaseBackHandler(now: () => number = Date.now): () => boolean {
  let lastPress = -Infinity;
  return () => {
    // Keyboard open: the first back press only hides it.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && isTextField(focused)) {
      focused.blur();
      return true;
    }
    const repoId = useRepoStore.getState().activeId ?? NO_REPO;
    const nav = useNavStore.getState();
    if (nav.pop(repoId)) return true;
    if ((nav.byRepo[repoId]?.tab ?? "history") !== "history") {
      nav.setTab(repoId, "history");
      return true;
    }
    const t = now();
    if (t - lastPress <= EXIT_WINDOW_MS) {
      lastPress = -Infinity;
      void commands.appExit();
      return true;
    }
    lastPress = t;
    toast("Press back again to exit");
    return true;
  };
}

/** Android-only behavior: back button handling and refetch on resume. No-op on desktop. */
export function usePlatformEffects(): void {
  const { mobile } = usePlatform();
  const client = useQueryClient();

  useEffect(() => {
    if (!mobile) return;
    const uninstall = installBackButton();
    const unregister = pushBackHandler(createBaseBackHandler());
    return () => {
      unregister();
      uninstall();
    };
  }, [mobile]);

  useEffect(() => {
    if (!mobile) return;
    let last = -Infinity;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < RESUME_THROTTLE_MS) return;
      last = now;
      const id = useRepoStore.getState().activeId;
      if (!id) return;
      void client.invalidateQueries({ queryKey: queryKeys.status(id) });
      void client.invalidateQueries({ queryKey: queryKeys.refs(id) });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [mobile, client]);
}
