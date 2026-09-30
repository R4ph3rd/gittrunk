import { isModifierKey, type KeyEventLike, type Platform } from "@/app/shortcuts";

/**
 * Converts a keydown into the shortcut string syntax the engine parses (`mod+shift+k`).
 * Returns null for modifier-only presses.
 */
export function chordFromEvent(e: KeyEventLike, platform: Platform): string | null {
  if (isModifierKey(e.key)) return null;
  const parts: string[] = [];
  const mac = platform === "mac";
  if (mac ? e.metaKey : e.ctrlKey) parts.push("mod");
  if (mac ? e.ctrlKey : e.metaKey) parts.push(mac ? "ctrl" : "meta");
  if (e.altKey) parts.push("alt");
  let key = e.key.toLowerCase();
  if (key === " ") key = "space";
  else if (key === "+") key = "plus";
  const symbol = key.length === 1 && !/[a-z0-9]/.test(key);
  if (e.shiftKey && !symbol) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}
