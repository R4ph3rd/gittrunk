import { useEffect } from "react";
import { create } from "zustand";
import { events, type CredentialRequested } from "@/ipc/bindings";

interface CredentialQueue {
  queue: CredentialRequested[];
  push: (r: CredentialRequested) => void;
  shift: (requestId: string) => void;
  reset: () => void;
}

/** Pending credential requests, oldest first. The head of the queue is the one on screen. */
export const useCredentialQueue = create<CredentialQueue>((set) => ({
  queue: [],
  push: (r) =>
    set((s) => (s.queue.some((q) => q.requestId === r.requestId) ? s : { queue: [...s.queue, r] })),
  shift: (requestId) => set((s) => ({ queue: s.queue.filter((q) => q.requestId !== requestId) })),
  reset: () => set({ queue: [] }),
}));

/** Subscribes to `credential-requested` and queues each request. */
export function useCredentialEvents() {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void events.credentialRequested
      .listen((e) => useCredentialQueue.getState().push(e.payload))
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
