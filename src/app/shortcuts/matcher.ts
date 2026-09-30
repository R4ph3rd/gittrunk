import {
  isModifierKey,
  matchesChord,
  parseShortcut,
  type KeyEventLike,
  type ParsedShortcut,
  type Platform,
} from "./parse";

export interface Binding {
  id: string;
  /** One or more shortcut strings, any of which triggers the binding. */
  shortcut: string | string[];
  /** Fire even when focus is in an input, textarea, select or contenteditable. */
  allowInInput?: boolean;
}

export interface MatcherEvent extends KeyEventLike {
  /** True when the event target is an editable element. */
  inInput: boolean;
}

export interface Matcher {
  /** Returns the matching binding id, or null. Buffers partial sequences internally. */
  handle: (e: MatcherEvent, bindings: Binding[], now?: number) => string | null;
  /** True while a sequence prefix is waiting for its next key. */
  pending: () => boolean;
  reset: () => void;
}

export const SEQUENCE_TIMEOUT_MS = 1000;

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

interface Entry {
  id: string;
  steps: ParsedShortcut;
  allowInInput: boolean;
}

function entries(bindings: Binding[]): Entry[] {
  const out: Entry[] = [];
  for (const b of bindings) {
    for (const s of Array.isArray(b.shortcut) ? b.shortcut : [b.shortcut]) {
      out.push({ id: b.id, steps: parseShortcut(s), allowInInput: b.allowInInput === true });
    }
  }
  return out;
}

export function createMatcher(
  platform: Platform,
  timeoutMs: number = SEQUENCE_TIMEOUT_MS,
): Matcher {
  let buffer: MatcherEvent[] = [];
  let last = 0;

  const resolve = (evs: MatcherEvent[], list: Entry[]) => {
    const inInput = evs.at(-1)!.inInput;
    const candidates = list.filter(
      (en) =>
        (!inInput || en.allowInInput) &&
        evs.length <= en.steps.length &&
        evs.every((ev, i) => matchesChord(ev, en.steps[i]!, platform)),
    );
    const exact = candidates.find((en) => en.steps.length === evs.length);
    return { exact, partial: candidates.some((en) => en.steps.length > evs.length) };
  };

  return {
    handle(e, bindings, now = Date.now()) {
      if (isModifierKey(e.key)) return null;
      if (buffer.length > 0 && now - last > timeoutMs) buffer = [];
      const list = entries(bindings);
      let evs = [...buffer, e];
      let r = resolve(evs, list);
      if (!r.exact && !r.partial && buffer.length > 0) {
        evs = [e];
        r = resolve(evs, list);
      }
      if (r.exact) {
        buffer = [];
        return r.exact.id;
      }
      if (r.partial) {
        buffer = evs;
        last = now;
        return null;
      }
      buffer = [];
      return null;
    },
    pending: () => buffer.length > 0,
    reset: () => {
      buffer = [];
    },
  };
}
