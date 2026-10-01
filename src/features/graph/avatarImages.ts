import type { QueryClient } from "@tanstack/react-query";
import { avatarKey, fetchAvatars } from "@/ipc/queries";

/** Avatar pixel size requested for graph nodes (drawn at 18 CSS px, 2x for sharpness). */
const AVATAR_SIZE = 64;
const DEBOUNCE_MS = 50;

type Entry = HTMLImageElement | null | "loading";

const cache = new Map<string, Entry>();
const queue = new Set<string>();
const waiting = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function keyOf(email: string): string {
  return email.trim().toLowerCase();
}

/** Cached image for an email: an image, `null` (none), `"loading"`, or undefined (never requested). */
export function peekAvatarImage(email: string): Entry | undefined {
  return cache.get(keyOf(email));
}

function decode(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
    if (typeof img.decode === "function") {
      img.decode().then(
        () => resolve(img),
        () => resolve(null),
      );
    }
  });
}

async function flush(client: QueryClient): Promise<void> {
  timer = null;
  const emails = [...queue];
  queue.clear();
  if (emails.length === 0) return;
  const callbacks = [...waiting];
  waiting.clear();
  try {
    const res = await fetchAvatars(
      client,
      emails.map((email) => ({ kind: "email" as const, email })),
      AVATAR_SIZE,
    );
    await Promise.all(
      emails.map(async (email) => {
        const url = res.get(avatarKey({ kind: "email", email })) ?? null;
        cache.set(email, url ? await decode(url) : null);
      }),
    );
  } catch {
    for (const email of emails) cache.set(email, null);
  }
  for (const cb of callbacks) cb();
}

/**
 * Asks for the avatars of emails not seen yet (debounced 50 ms, deduped, cached per module).
 * `onLoaded` runs once the batch is decoded, so the caller can redraw.
 */
export function requestAvatarImages(
  client: QueryClient,
  emails: Iterable<string>,
  onLoaded: () => void,
): void {
  let added = false;
  for (const raw of emails) {
    const email = keyOf(raw);
    if (!email || cache.has(email)) continue;
    cache.set(email, "loading");
    queue.add(email);
    added = true;
  }
  if (!added) return;
  waiting.add(onLoaded);
  timer ??= setTimeout(() => void flush(client), DEBOUNCE_MS);
}

/** Forgets every decoded image (avatar setting changed, tests). */
export function resetAvatarImages(): void {
  cache.clear();
  queue.clear();
  waiting.clear();
  if (timer) clearTimeout(timer);
  timer = null;
}
