import { useEffect, useState } from "react";
import { runSilentOp } from "@/features/ops/ops";
import { useOpsStore } from "@/features/ops/store";
import { commands } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { useRepoStore } from "@/stores/repo";
import { getPruneOnFetch, useSettings } from "@/stores/settings";

/** First fetch after a repository is opened (or auto-fetch is switched on). */
export const INITIAL_DELAY_MS = 3_000;
/** Minimum spacing of fetches triggered by the window regaining focus. */
export const FOCUS_THROTTLE_MS = 60_000;

export interface AutoFetchDeps {
  now: () => number;
  /** Whether a manual operation (fetch, pull, push...) is running for the repo. */
  isBusy: (repoId: string) => boolean;
  /** Fetches all remotes quietly; resolves when done. Must not reject. */
  fetch: (repoId: string) => Promise<void>;
  hasRemotes: (repoId: string) => Promise<boolean>;
}

/**
 * Periodic quiet fetch for a set of repositories. Pure scheduling logic on top of timers, so it
 * is testable with fake timers; the React hook below wires it to the app.
 */
export class AutoFetcher {
  private minutes = 0;
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private initial = new Map<string, ReturnType<typeof setTimeout>>();
  private last = new Map<string, number>();
  private running = new Set<string>();

  constructor(private deps: AutoFetchDeps) {}

  /** Applies the current settings and the set of open repositories. */
  update(repoIds: string[], minutes: number) {
    const changed = minutes !== this.minutes;
    this.minutes = minutes;
    const wanted = new Set(minutes > 0 ? repoIds : []);
    for (const id of [...this.timers.keys(), ...this.initial.keys()]) {
      if (!wanted.has(id)) this.stop(id);
    }
    for (const id of wanted) {
      if (changed) this.stop(id);
      if (this.timers.has(id)) continue;
      this.initial.set(
        id,
        setTimeout(() => {
          this.initial.delete(id);
          void this.run(id);
        }, INITIAL_DELAY_MS),
      );
      this.timers.set(
        id,
        setInterval(() => void this.run(id), minutes * 60_000),
      );
    }
  }

  /** The window regained focus: refresh repositories not fetched within the throttle window. */
  focus() {
    if (this.minutes <= 0) return;
    for (const id of this.timers.keys()) {
      const last = this.last.get(id);
      if (last === undefined || this.deps.now() - last >= FOCUS_THROTTLE_MS) void this.run(id);
    }
  }

  dispose() {
    this.update([], 0);
  }

  private stop(id: string) {
    const t = this.timers.get(id);
    if (t !== undefined) clearInterval(t);
    const i = this.initial.get(id);
    if (i !== undefined) clearTimeout(i);
    this.timers.delete(id);
    this.initial.delete(id);
  }

  private async run(id: string) {
    if (this.running.has(id) || this.deps.isBusy(id)) return;
    this.running.add(id);
    try {
      this.last.set(id, this.deps.now());
      if (!(await this.deps.hasRemotes(id))) return;
      await this.deps.fetch(id);
    } catch {
      /* background fetches fail silently */
    } finally {
      this.running.delete(id);
    }
  }
}

/** Fetches every open repository in the background, per the "Fetch automatically" setting. */
export function useAutoFetch() {
  const { autoFetchMinutes } = useSettings();
  const ids = useRepoStore((s) => s.repos.map((r) => r.id).join("\n"));
  const [fetcher] = useState(
    () =>
      new AutoFetcher({
        now: () => Date.now(),
        isBusy: (id) => Object.values(useOpsStore.getState().ops).some((o) => o.repoId === id),
        hasRemotes: async (id) => (await unwrap(commands.remoteList(id))).length > 0,
        fetch: (id) =>
          runSilentOp(id, () => unwrap(commands.fetchBackground(id, getPruneOnFetch()))),
      }),
  );

  useEffect(() => {
    const onFocus = () => fetcher.focus();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      fetcher.dispose();
    };
  }, [fetcher]);

  useEffect(() => {
    fetcher.update(ids ? ids.split("\n") : [], autoFetchMinutes);
  }, [fetcher, ids, autoFetchMinutes]);
}
