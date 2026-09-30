import type { Extension } from "@codemirror/state";
import { EditorView } from "codemirror";

/**
 * CodeMirror theme built only from design tokens (CSS variables), so it follows the app theme
 * and `--accent`. Syntax colors come from CodeMirror's fallback highlight style (see gaps).
 */
export const gittrunkTheme: Extension = EditorView.theme({
  "&": {
    color: "var(--fg)",
    backgroundColor: "var(--bg-subtle)",
    fontSize: "var(--text-sm)",
    height: "100%",
  },
  "&.cm-focused": { outline: "1px solid var(--focus-ring)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  ".cm-gutters": {
    backgroundColor: "var(--bg-subtle)",
    color: "var(--fg-subtle)",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLine": { backgroundColor: "var(--surface-hover)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--surface-hover)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection)",
  },
  ".gt-conflict-ours": { backgroundColor: "color-mix(in srgb, var(--success) 14%, transparent)" },
  ".gt-conflict-theirs": { backgroundColor: "color-mix(in srgb, var(--accent) 16%, transparent)" },
  ".gt-conflict-base": { backgroundColor: "color-mix(in srgb, var(--warning) 14%, transparent)" },
  ".gt-conflict-marker": { color: "var(--fg-subtle)", backgroundColor: "var(--surface-hover)" },
  ".gt-conflict-actions": {
    display: "flex",
    gap: "var(--space-1)",
    alignItems: "center",
    padding: "2px var(--space-2)",
    backgroundColor: "var(--surface-raised)",
    borderTop: "1px solid var(--border)",
    fontFamily: "var(--font-sans)",
  },
  ".gt-conflict-actions button": {
    height: "var(--control-sm)",
    padding: "0 var(--space-2)",
    fontSize: "var(--text-xs)",
    color: "var(--fg)",
    backgroundColor: "var(--surface-hover)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  ".gt-conflict-actions button:hover": {
    borderColor: "var(--accent)",
    color: "var(--accent)",
  },
  ".gt-conflict-actions button:focus-visible": { outline: "2px solid var(--focus-ring)" },
  ".gt-conflict-title": {
    color: "var(--fg-muted)",
    fontSize: "var(--text-xs)",
    marginRight: "auto",
  },
});

/** Loads the language support for a file name from `@codemirror/language-data`, or null. */
export async function loadLanguage(path: string): Promise<Extension | null> {
  const name = path.split("/").pop() ?? path;
  const lower = name.toLowerCase();
  const { languages } = await import("@codemirror/language-data");
  const desc = languages.find(
    (l) => l.filename?.test(name) || l.extensions.some((e) => lower.endsWith(`.${e}`)),
  );
  if (!desc) return null;
  try {
    return await desc.load();
  } catch {
    return null;
  }
}
