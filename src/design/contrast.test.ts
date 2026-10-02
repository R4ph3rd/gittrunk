/// <reference types="node" />
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Parse hex color to RGB */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  const val = parseInt(h, 16);
  return [(val >> 16) & 255, (val >> 8) & 255, val & 255];
}

/** Parse rgb(r g b / a) format */
function parseRgb(rgb: string): [number, number, number, number] {
  const match = rgb.match(/rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)/);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4])
    throw new Error(`Invalid rgb format: ${rgb}`);
  return [
    parseInt(match[1], 10),
    parseInt(match[2], 10),
    parseInt(match[3], 10),
    parseFloat(match[4]),
  ];
}

/** Compute relative luminance per WCAG formula */
function getLuminance(r: number, g: number, b: number): number {
  const normalize = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.05) / 1.05, 2.4));
  const rs = normalize(r / 255);
  const gs = normalize(g / 255);
  const bs = normalize(b / 255);
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Compute WCAG contrast ratio between two colors */
function getContrast(c1: [number, number, number], c2: [number, number, number]): number {
  const l1 = getLuminance(...c1);
  const l2 = getLuminance(...c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Resolve CSS variable references in color value */
function resolveColor(
  value: string,
  tokens: Record<string, string>,
  resolved: Set<string> = new Set(),
): [number, number, number] {
  if (resolved.size > 10) throw new Error("Circular reference in CSS variables");

  // If it's a var(...), resolve it
  const varMatch = value.match(/^var\(--([^)]+)\)$/);
  if (varMatch?.[1]) {
    const varName = varMatch[1];
    resolved.add(varName);
    const varValue = tokens[varName];
    if (!varValue) throw new Error(`Undefined token: --${varName}`);
    return resolveColor(varValue, tokens, resolved);
  }

  // If it's an rgb() with var references, resolve those first
  if (value.includes("var(")) {
    let resolvedValue = value;
    const varMatches = [...value.matchAll(/var\(--([^)]+)\)/g)];
    for (const match of varMatches) {
      if (!match[1]) continue;
      const varName = match[1];
      const varValue = tokens[varName];
      if (!varValue) throw new Error(`Undefined token: --${varName}`);
      resolvedValue = resolvedValue.replace(match[0], varValue);
    }
    return resolveColor(resolvedValue, tokens, resolved);
  }

  // Parse hex color
  if (value.startsWith("#")) {
    return hexToRgb(value);
  }

  // Parse rgb() color
  if (value.startsWith("rgb(")) {
    const [r, g, b, a] = parseRgb(value);
    // Apply alpha blending on white background (light) or black (dark)
    const isLight = a < 0.5; // rough heuristic
    const bg: [number, number, number] = isLight ? [255, 255, 255] : [0, 0, 0];
    return [
      Math.round(r * a + bg[0]! * (1 - a)),
      Math.round(g * a + bg[1]! * (1 - a)),
      Math.round(b * a + bg[2]! * (1 - a)),
    ];
  }

  throw new Error(`Cannot parse color: ${value}`);
}

describe("WCAG contrast", () => {
  const tokensCssPath = resolve(__dirname, "tokens.css");
  const css = readFileSync(tokensCssPath, "utf8");

  // Extract all token values for both dark and light themes
  const darkTokens: Record<string, string> = {};
  const lightTokens: Record<string, string> = {};

  // Parse :root, [data-theme="dark"] block
  const darkMatch = css.match(/:root,\s*\[data-theme="dark"\]\s*\{([^}]+)\}/s);
  if (darkMatch?.[1]) {
    const block = darkMatch[1];
    const tokenRegex = /--([a-z0-9-]+):\s*([^;]+);/g;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(block)) !== null) {
      if (match[1] && match[2]) {
        darkTokens[match[1]] = match[2].trim();
      }
    }
  }

  // Parse [data-theme="light"] block
  const lightMatch = css.match(/\[data-theme="light"\]\s*\{([^}]+)\}/s);
  if (lightMatch?.[1]) {
    const block = lightMatch[1];
    const tokenRegex = /--([a-z0-9-]+):\s*([^;]+);/g;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(block)) !== null) {
      if (match[1] && match[2]) {
        lightTokens[match[1]] = match[2].trim();
      }
    }
  }

  // Helper to safely get a token value
  const getToken = (tokens: Record<string, string>, key: string): string => {
    const value = tokens[key];
    if (!value) throw new Error(`Missing token: --${key}`);
    return value;
  };

  describe("dark theme", () => {
    it("should have >= 4.5 contrast for --fg on surfaces", () => {
      const fg = resolveColor(getToken(darkTokens, "fg"), darkTokens);
      const surfaces = [
        "bg",
        "bg-subtle",
        "surface",
        "surface-raised",
        "surface-hover",
        "toolbar-bg",
        "tabbar-bg",
      ];
      for (const surface of surfaces) {
        const bg = resolveColor(getToken(darkTokens, surface), darkTokens);
        const ratio = getContrast(fg, bg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("should have >= 4.5 contrast for --fg-muted on surfaces", () => {
      const fg = resolveColor(getToken(darkTokens, "fg-muted"), darkTokens);
      const surfaces = [
        "bg",
        "bg-subtle",
        "surface",
        "surface-raised",
        "surface-hover",
        "toolbar-bg",
        "tabbar-bg",
      ];
      for (const surface of surfaces) {
        const bg = resolveColor(getToken(darkTokens, surface), darkTokens);
        const ratio = getContrast(fg, bg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("should have >= 4.5 contrast for --fg-subtle on surfaces", () => {
      const fg = resolveColor(getToken(darkTokens, "fg-subtle"), darkTokens);
      const surfaces = [
        "bg",
        "bg-subtle",
        "surface",
        "surface-raised",
        "surface-hover",
        "toolbar-bg",
      ];
      for (const surface of surfaces) {
        const bg = resolveColor(getToken(darkTokens, surface), darkTokens);
        const ratio = getContrast(fg, bg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("should have >= 4.5 contrast for accent/danger/success/warning on surface", () => {
      const accent = resolveColor(getToken(darkTokens, "accent"), darkTokens);
      const danger = resolveColor(getToken(darkTokens, "danger"), darkTokens);
      const success = resolveColor(getToken(darkTokens, "success"), darkTokens);
      const warning = resolveColor(getToken(darkTokens, "warning"), darkTokens);
      const bg = resolveColor(getToken(darkTokens, "bg"), darkTokens);
      const surface = resolveColor(getToken(darkTokens, "surface"), darkTokens);

      expect(getContrast(accent, surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(danger, surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(success, surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(warning, surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(accent, bg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(danger, bg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(success, bg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(warning, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it("should have >= 4.5 contrast for accent-fg on accent", () => {
      const fgAccent = resolveColor(getToken(darkTokens, "accent-fg"), darkTokens);
      const accent = resolveColor(getToken(darkTokens, "accent"), darkTokens);
      const ratio = getContrast(fgAccent, accent);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it("should have >= 4.5 contrast for danger-fg on danger", () => {
      const fgDanger = resolveColor(getToken(darkTokens, "danger-fg"), darkTokens);
      const danger = resolveColor(getToken(darkTokens, "danger"), darkTokens);
      const ratio = getContrast(fgDanger, danger);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it("should have >= 3 contrast for lane-fg on every lane", () => {
      const laneFg = resolveColor(getToken(darkTokens, "lane-fg"), darkTokens);
      for (let i = 0; i < 8; i++) {
        const lane = resolveColor(getToken(darkTokens, `lane-${i}`), darkTokens);
        const ratio = getContrast(laneFg, lane);
        expect(ratio).toBeGreaterThanOrEqual(3);
      }
    });

    it("should have >= 3 contrast for every lane on surface", () => {
      const surface = resolveColor(getToken(darkTokens, "surface"), darkTokens);
      for (let i = 0; i < 8; i++) {
        const lane = resolveColor(getToken(darkTokens, `lane-${i}`), darkTokens);
        const ratio = getContrast(lane, surface);
        expect(ratio).toBeGreaterThanOrEqual(3);
      }
    });

    it("should have >= 3 contrast for accent on tabbar-bg", () => {
      const accent = resolveColor(getToken(darkTokens, "accent"), darkTokens);
      const tabbar = resolveColor(getToken(darkTokens, "tabbar-bg"), darkTokens);
      const ratio = getContrast(accent, tabbar);
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  });

  describe("light theme", () => {
    it("should have >= 4.5 contrast for --fg on surfaces", () => {
      const fg = resolveColor(getToken(lightTokens, "fg"), lightTokens);
      const surfaces = [
        "bg",
        "bg-subtle",
        "surface",
        "surface-raised",
        "surface-hover",
        "toolbar-bg",
        "tabbar-bg",
      ];
      for (const surface of surfaces) {
        const bg = resolveColor(getToken(lightTokens, surface), lightTokens);
        const ratio = getContrast(fg, bg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("should have >= 4.5 contrast for --fg-muted on surfaces", () => {
      const fg = resolveColor(getToken(lightTokens, "fg-muted"), lightTokens);
      const surfaces = [
        "bg",
        "bg-subtle",
        "surface",
        "surface-raised",
        "surface-hover",
        "toolbar-bg",
        "tabbar-bg",
      ];
      for (const surface of surfaces) {
        const bg = resolveColor(getToken(lightTokens, surface), lightTokens);
        const ratio = getContrast(fg, bg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("should have >= 4.5 contrast for --fg-subtle on surfaces", () => {
      const fg = resolveColor(getToken(lightTokens, "fg-subtle"), lightTokens);
      const surfaces = [
        "bg",
        "bg-subtle",
        "surface",
        "surface-raised",
        "surface-hover",
        "toolbar-bg",
      ];
      for (const surface of surfaces) {
        const bg = resolveColor(getToken(lightTokens, surface), lightTokens);
        const ratio = getContrast(fg, bg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("should have >= 4.5 contrast for accent/danger/success/warning on surface", () => {
      const accent = resolveColor(getToken(lightTokens, "accent"), lightTokens);
      const danger = resolveColor(getToken(lightTokens, "danger"), lightTokens);
      const success = resolveColor(getToken(lightTokens, "success"), lightTokens);
      const warning = resolveColor(getToken(lightTokens, "warning"), lightTokens);
      const bg = resolveColor(getToken(lightTokens, "bg"), lightTokens);
      const surface = resolveColor(getToken(lightTokens, "surface"), lightTokens);

      expect(getContrast(accent, surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(danger, surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(success, surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(warning, surface)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(accent, bg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(danger, bg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(success, bg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(warning, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it("should have >= 4.5 contrast for accent-fg on accent", () => {
      const fgAccent = resolveColor(getToken(lightTokens, "accent-fg"), lightTokens);
      const accent = resolveColor(getToken(lightTokens, "accent"), lightTokens);
      const ratio = getContrast(fgAccent, accent);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it("should have >= 4.5 contrast for danger-fg on danger", () => {
      const fgDanger = resolveColor(getToken(lightTokens, "danger-fg"), lightTokens);
      const danger = resolveColor(getToken(lightTokens, "danger"), lightTokens);
      const ratio = getContrast(fgDanger, danger);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it("should have >= 3 contrast for lane-fg on every lane", () => {
      const laneFg = resolveColor(getToken(lightTokens, "lane-fg"), lightTokens);
      for (let i = 0; i < 8; i++) {
        const lane = resolveColor(getToken(lightTokens, `lane-${i}`), lightTokens);
        const ratio = getContrast(laneFg, lane);
        expect(ratio).toBeGreaterThanOrEqual(3);
      }
    });

    it("should have >= 3 contrast for every lane on surface", () => {
      const surface = resolveColor(getToken(lightTokens, "surface"), lightTokens);
      for (let i = 0; i < 8; i++) {
        const lane = resolveColor(getToken(lightTokens, `lane-${i}`), lightTokens);
        const ratio = getContrast(lane, surface);
        expect(ratio).toBeGreaterThanOrEqual(3);
      }
    });

    it("should have >= 3 contrast for accent on tabbar-bg", () => {
      const accent = resolveColor(getToken(lightTokens, "accent"), lightTokens);
      const tabbar = resolveColor(getToken(lightTokens, "tabbar-bg"), lightTokens);
      const ratio = getContrast(accent, tabbar);
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  });

  describe("backdrop", () => {
    const blend = (
      base: [number, number, number],
      top: [number, number, number],
      a: number,
    ): [number, number, number] => [
      base[0] * (1 - a) + top[0] * a,
      base[1] * (1 - a) + top[1] * a,
      base[2] * (1 - a) + top[2] * a,
    ];
    /** All three blobs stacked at peak alpha over the base color. */
    const stacked = (tokens: Record<string, string>, base: string, alphaToken: string) => {
      const alpha = parseFloat(getToken(tokens, alphaToken));
      let c: [number, number, number] = resolveColor(getToken(tokens, base), tokens);
      for (const n of [1, 2, 3]) {
        c = blend(c, resolveColor(getToken(tokens, `backdrop-${n}`), tokens), alpha);
      }
      return c;
    };
    const rnd = (c: [number, number, number]): [number, number, number] => [
      Math.round(c[0]),
      Math.round(c[1]),
      Math.round(c[2]),
    ];

    const themes: [string, Record<string, string>][] = [
      ["dark", darkTokens],
      ["light", lightTokens],
    ];
    for (const [name, tokens] of themes) {
      it(`${name}: subtle over --surface keeps text >= 4.5 and lanes >= 3`, () => {
        const base = rnd(stacked(tokens, "surface", "backdrop-alpha-subtle"));
        for (const t of ["fg", "fg-muted", "fg-subtle", "accent"]) {
          const fg = resolveColor(getToken(tokens, t), tokens);
          expect(getContrast(fg, base), t).toBeGreaterThanOrEqual(4.5);
        }
        for (let i = 0; i < 8; i++) {
          const lane = resolveColor(getToken(tokens, `lane-${i}`), tokens);
          expect(getContrast(lane, base), `lane-${i}`).toBeGreaterThanOrEqual(3);
        }
      });

      it(`${name}: page over --bg keeps fg and fg-muted >= 4.5`, () => {
        const base = rnd(stacked(tokens, "bg", "backdrop-alpha-page"));
        for (const t of ["fg", "fg-muted"]) {
          const fg = resolveColor(getToken(tokens, t), tokens);
          expect(getContrast(fg, base), t).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  });
});
