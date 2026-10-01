import type { ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

function readVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** xterm theme from the `--terminal-*` tokens. ANSI colors stay xterm defaults. */
export function readTerminalTheme(): ITheme {
  return {
    background: readVar("--terminal-bg", "transparent"),
    foreground: readVar("--terminal-fg", "currentColor"),
    cursor: readVar("--terminal-cursor", "currentColor"),
    selectionBackground: readVar("--terminal-selection", "transparent"),
  };
}

export function readTerminalFont(): { fontFamily: string; fontSize: number } {
  return { fontFamily: readVar("--font-mono", "monospace"), fontSize: 12 };
}

function parseRgb(css: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(css);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** SGR sequence that switches the foreground to `--fg-subtle` (dim as a fallback). */
export function subtleSgr(): string {
  const rgb = parseRgb(readVar("--fg-subtle", ""));
  return rgb ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m` : "\x1b[2m";
}
