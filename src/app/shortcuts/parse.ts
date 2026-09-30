/** Pure shortcut helpers: parse, match, format and conflict detection. No DOM access. */

export type Platform = "mac" | "other";

export interface Chord {
  key: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

/** A shortcut is one chord, or several for a sequence such as `g b`. */
export type ParsedShortcut = Chord[];

/** The subset of KeyboardEvent the engine reads. */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  space: " ",
  spacebar: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  del: "delete",
  plus: "+",
};

const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta", "altgraph", "os"]);

export function detectPlatform(nav?: { platform?: string; userAgent?: string }): Platform {
  const n = nav ?? (typeof navigator === "undefined" ? undefined : navigator);
  const text = `${n?.platform ?? ""} ${n?.userAgent ?? ""}`;
  return /mac|iphone|ipad/i.test(text) ? "mac" : "other";
}

function normalizeKey(key: string): string {
  const k = key.toLowerCase();
  return KEY_ALIASES[k] ?? k;
}

export function parseChord(text: string): Chord {
  const parts = text.trim().split("+");
  const chord: Chord = { key: "", mod: false, ctrl: false, shift: false, alt: false, meta: false };
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i] ?? "";
    const p = raw.toLowerCase();
    if (raw === "" && i === parts.length - 1 && i > 0) chord.key = "+";
    else if (p === "mod") chord.mod = true;
    else if (p === "ctrl" || p === "control") chord.ctrl = true;
    else if (p === "shift") chord.shift = true;
    else if (p === "alt" || p === "option") chord.alt = true;
    else if (p === "meta" || p === "cmd" || p === "command") chord.meta = true;
    else chord.key = normalizeKey(raw);
  }
  if (!chord.key) throw new Error(`Invalid shortcut: "${text}"`);
  return chord;
}

/** `"mod+k"` -> one chord; `"g b"` -> a two-step sequence. */
export function parseShortcut(text: string): ParsedShortcut {
  const steps = text.trim().split(/\s+/).filter(Boolean);
  if (steps.length === 0) throw new Error("Empty shortcut");
  return steps.map(parseChord);
}

/** Symbols such as `?` are produced with Shift; Shift is not part of their identity. */
function shiftIsImplicit(key: string): boolean {
  return key.length === 1 && !/[a-z0-9]/.test(key);
}

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key.toLowerCase());
}

export function matchesChord(e: KeyEventLike, chord: Chord, platform: Platform): boolean {
  if (normalizeKey(e.key) !== chord.key) return false;
  const wantCtrl = chord.ctrl || (chord.mod && platform === "other");
  const wantMeta = chord.meta || (chord.mod && platform === "mac");
  if (e.ctrlKey !== wantCtrl || e.metaKey !== wantMeta || e.altKey !== chord.alt) return false;
  if (shiftIsImplicit(chord.key)) return true;
  return e.shiftKey === chord.shift;
}

const KEY_SYMBOLS: Record<string, string> = {
  enter: "↵",
  escape: "Esc",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  backspace: "⌫",
  delete: "⌦",
  " ": "Space",
};

function formatKey(key: string): string {
  const mapped = KEY_SYMBOLS[key];
  if (mapped) return mapped;
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function formatChord(chord: Chord, platform: Platform): string {
  const key = formatKey(chord.key);
  if (platform === "mac") {
    let out = "";
    if (chord.ctrl) out += "⌃";
    if (chord.alt) out += "⌥";
    if (chord.shift) out += "⇧";
    if (chord.meta || chord.mod) out += "⌘";
    return out + key;
  }
  const parts: string[] = [];
  if (chord.ctrl || chord.mod) parts.push("Ctrl");
  if (chord.meta) parts.push("Meta");
  if (chord.alt) parts.push("Alt");
  if (chord.shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** Display text: `⌘K` on macOS, `Ctrl+K` elsewhere. Sequence steps are separated by a space. */
export function formatShortcut(shortcut: string, platform: Platform = detectPlatform()): string {
  return parseShortcut(shortcut)
    .map((c) => formatChord(c, platform))
    .join(" ");
}

/** Canonical form used for equality and conflict checks. */
export function normalizeShortcut(shortcut: string, platform: Platform): string {
  return parseShortcut(shortcut)
    .map((c) => {
      const ctrl = c.ctrl || (c.mod && platform === "other");
      const meta = c.meta || (c.mod && platform === "mac");
      const shift = c.shift && !shiftIsImplicit(c.key);
      return [ctrl && "ctrl", meta && "meta", c.alt && "alt", shift && "shift", c.key]
        .filter(Boolean)
        .join("+");
    })
    .join(" ");
}

export interface ShortcutOwner {
  id: string;
  shortcut: string;
}

export interface ShortcutConflict {
  shortcut: string;
  ids: string[];
  /** `same` = identical shortcut; `prefix` = a chord shadows a longer sequence. */
  kind: "same" | "prefix";
}

/** Finds commands whose shortcuts collide, or where a single chord shadows a sequence. */
export function findConflicts(owners: ShortcutOwner[], platform: Platform): ShortcutConflict[] {
  const norm = owners.map((o) => ({ id: o.id, n: normalizeShortcut(o.shortcut, platform) }));
  const out: ShortcutConflict[] = [];
  const byShortcut = new Map<string, string[]>();
  for (const o of norm) byShortcut.set(o.n, [...(byShortcut.get(o.n) ?? []), o.id]);
  for (const [shortcut, ids] of byShortcut) {
    if (new Set(ids).size > 1) out.push({ shortcut, ids, kind: "same" });
  }
  for (const a of norm) {
    for (const b of norm) {
      if (a.n !== b.n && b.n.startsWith(`${a.n} `)) {
        out.push({ shortcut: a.n, ids: [a.id, b.id], kind: "prefix" });
      }
    }
  }
  return out;
}
