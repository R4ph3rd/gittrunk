import { describe, expect, it } from "vitest";
import {
  createMatcher,
  detectPlatform,
  findConflicts,
  formatShortcut,
  matchesChord,
  parseShortcut,
  type Binding,
  type MatcherEvent,
} from "./index";

const ev = (key: string, extra: Partial<MatcherEvent> = {}): MatcherEvent => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  inInput: false,
  ...extra,
});

describe("parseShortcut", () => {
  it("parses modifiers, keys and sequences", () => {
    expect(parseShortcut("mod+shift+p")).toEqual([
      { key: "p", mod: true, ctrl: false, shift: true, alt: false, meta: false },
    ]);
    expect(parseShortcut("g b").map((c) => c.key)).toEqual(["g", "b"]);
    expect(parseShortcut("esc")[0]?.key).toBe("escape");
    expect(parseShortcut("mod++")[0]?.key).toBe("+");
  });

  it("rejects empty shortcuts", () => {
    expect(() => parseShortcut("  ")).toThrow();
    expect(() => parseShortcut("mod+shift")).toThrow();
  });
});

describe("matchesChord", () => {
  const [k] = parseShortcut("mod+k");
  it("maps mod to Cmd on mac and Ctrl elsewhere", () => {
    expect(matchesChord(ev("k", { metaKey: true }), k!, "mac")).toBe(true);
    expect(matchesChord(ev("k", { ctrlKey: true }), k!, "mac")).toBe(false);
    expect(matchesChord(ev("k", { ctrlKey: true }), k!, "other")).toBe(true);
    expect(matchesChord(ev("k", { metaKey: true }), k!, "other")).toBe(false);
  });

  it("requires exact modifiers and is case-insensitive", () => {
    const [p] = parseShortcut("mod+shift+p");
    expect(matchesChord(ev("P", { ctrlKey: true, shiftKey: true }), p!, "other")).toBe(true);
    expect(matchesChord(ev("p", { ctrlKey: true }), p!, "other")).toBe(false);
    expect(matchesChord(ev("k", { ctrlKey: true, altKey: true }), k!, "other")).toBe(false);
  });

  it("ignores shift for symbol keys such as ?", () => {
    const [q] = parseShortcut("?");
    expect(matchesChord(ev("?", { shiftKey: true }), q!, "other")).toBe(true);
  });
});

describe("formatShortcut", () => {
  it("formats per platform", () => {
    expect(formatShortcut("mod+k", "mac")).toBe("⌘K");
    expect(formatShortcut("mod+k", "other")).toBe("Ctrl+K");
    expect(formatShortcut("mod+shift+p", "mac")).toBe("⇧⌘P");
    expect(formatShortcut("mod+shift+p", "other")).toBe("Ctrl+Shift+P");
    expect(formatShortcut("g b", "other")).toBe("G B");
    expect(formatShortcut("ctrl+tab", "mac")).toBe("⌃Tab");
    expect(formatShortcut("mod+enter", "other")).toBe("Ctrl+↵");
  });

  it("detects the platform", () => {
    expect(detectPlatform({ platform: "MacIntel" })).toBe("mac");
    expect(detectPlatform({ platform: "Win32", userAgent: "Windows" })).toBe("other");
  });
});

describe("createMatcher", () => {
  const bindings: Binding[] = [
    { id: "open", shortcut: "mod+o" },
    { id: "palette", shortcut: ["mod+k", "mod+shift+p"], allowInInput: true },
    { id: "branch", shortcut: "g b" },
    { id: "graph", shortcut: "g g" },
    { id: "help", shortcut: "?" },
  ];

  it("matches chords and aliases", () => {
    const m = createMatcher("other");
    expect(m.handle(ev("k", { ctrlKey: true }), bindings)).toBe("palette");
    expect(m.handle(ev("P", { ctrlKey: true, shiftKey: true }), bindings)).toBe("palette");
    expect(m.handle(ev("?", { shiftKey: true }), bindings)).toBe("help");
  });

  it("suppresses shortcuts inside inputs unless allowInInput", () => {
    const m = createMatcher("other");
    expect(m.handle(ev("o", { ctrlKey: true, inInput: true }), bindings)).toBeNull();
    expect(m.handle(ev("k", { ctrlKey: true, inInput: true }), bindings)).toBe("palette");
    expect(m.handle(ev("?", { inInput: true }), bindings)).toBeNull();
  });

  it("matches sequences and times out", () => {
    const m = createMatcher("other", 1000);
    expect(m.handle(ev("g"), bindings, 0)).toBeNull();
    expect(m.pending()).toBe(true);
    expect(m.handle(ev("b"), bindings, 500)).toBe("branch");
    expect(m.pending()).toBe(false);

    expect(m.handle(ev("g"), bindings, 0)).toBeNull();
    expect(m.handle(ev("b"), bindings, 1500)).toBeNull();

    expect(m.handle(ev("g"), bindings, 0)).toBeNull();
    expect(m.handle(ev("x"), bindings, 100)).toBeNull();
    expect(m.pending()).toBe(false);
  });

  it("restarts a sequence when the next key does not continue it", () => {
    const m = createMatcher("other");
    m.handle(ev("g"), bindings, 0);
    expect(m.handle(ev("?", { shiftKey: true }), bindings, 10)).toBe("help");
  });

  it("ignores bare modifier presses", () => {
    const m = createMatcher("other");
    m.handle(ev("g"), bindings, 0);
    expect(m.handle(ev("Shift", { shiftKey: true }), bindings, 10)).toBeNull();
    expect(m.handle(ev("g"), bindings, 20)).toBe("graph");
  });
});

describe("findConflicts", () => {
  it("reports identical and shadowing shortcuts", () => {
    const owners = [
      { id: "a", shortcut: "mod+k" },
      { id: "b", shortcut: "mod+k" },
      { id: "c", shortcut: "g" },
      { id: "d", shortcut: "g b" },
      { id: "e", shortcut: "mod+j" },
    ];
    const found = findConflicts(owners, "other");
    expect(found).toContainEqual({ shortcut: "ctrl+k", ids: ["a", "b"], kind: "same" });
    expect(found).toContainEqual({ shortcut: "g", ids: ["c", "d"], kind: "prefix" });
    expect(found).toHaveLength(2);
  });

  it("treats mod and ctrl as the same on non-mac only", () => {
    const owners = [
      { id: "a", shortcut: "mod+k" },
      { id: "b", shortcut: "ctrl+k" },
    ];
    expect(findConflicts(owners, "other")).toHaveLength(1);
    expect(findConflicts(owners, "mac")).toHaveLength(0);
  });
});
