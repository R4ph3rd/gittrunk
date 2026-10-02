import { create } from "zustand";
import { useRepoStore } from "./repo";

export type NotificationLevel = "success" | "error" | "warning" | "info";

export interface AppNotification {
  id: string;
  level: NotificationLevel;
  title: string;
  detail: string | null;
  /** Milliseconds since the epoch. */
  at: number;
  /** Name of the active repository when it was raised, if any. */
  source: string | null;
  read: boolean;
}

export const MAX_NOTIFICATIONS = 50;

let counter = 0;

interface NotificationsState {
  /** Newest first, at most MAX_NOTIFICATIONS. In memory only (session). */
  items: AppNotification[];
  push(n: { level: NotificationLevel; title: string; detail?: string | null }): void;
  markAllRead(): void;
  clear(): void;
  reset(): void;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  items: [],
  push: (n) => {
    counter += 1;
    const repos = useRepoStore.getState();
    const source = repos.repos.find((r) => r.id === repos.activeId)?.name ?? null;
    const item: AppNotification = {
      id: `n-${counter}`,
      level: n.level,
      title: n.title,
      detail: n.detail ?? null,
      at: Date.now(),
      source,
      read: false,
    };
    set((s) => ({ items: [item, ...s.items].slice(0, MAX_NOTIFICATIONS) }));
  },
  markAllRead: () =>
    set((s) =>
      s.items.some((i) => !i.read) ? { items: s.items.map((i) => ({ ...i, read: true })) } : s,
    ),
  clear: () => set({ items: [] }),
  reset: () => set({ items: [] }),
}));

/** Number of unread items. */
export function useUnreadNotifications(): number {
  return useNotificationsStore((s) => s.items.filter((i) => !i.read).length);
}
