/** Pure helpers for the Changes panel path actions (ignore patterns, patch names). */

/** Escapes the characters gitignore treats as wildcards. */
function escapeGlob(text: string): string {
  return text.replace(/[\\*?[\]]/g, "\\$&");
}

/**
 * Anchored gitignore pattern for a repository-relative path: `/dir/file.txt`, or `/dir/` for a
 * folder. Wildcard characters in the name are escaped so the pattern matches only that path.
 */
export function ignorePattern(path: string, isDir: boolean): string {
  const escaped = escapeGlob(path);
  if (isDir) return `/${escaped}/`;
  return `/${escaped.replace(/ +$/, (spaces) => spaces.replace(/ /g, "\\ "))}`;
}

/** File extension without the dot (`archive.tar.gz` gives `gz`); null for `Makefile`, `.env` or `a.`. */
export function extensionOf(path: string): string | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1);
  return /\s/.test(ext) ? null : ext;
}

/** `*.log` pattern for an extension. */
export const extensionPattern = (ext: string): string => `*.${escapeGlob(ext)}`;

/** The extension shared by every path, or null when there is none or they differ. */
export function commonExtension(paths: readonly string[]): string | null {
  const first = paths[0];
  if (first === undefined) return null;
  const ext = extensionOf(first);
  if (!ext) return null;
  return paths.every((p) => extensionOf(p) === ext) ? ext : null;
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Default file name offered by the save dialog. */
export function patchFileName(paths: readonly string[]): string {
  const only = paths.length === 1 ? paths[0] : undefined;
  return only ? `${baseName(only)}.patch` : "changes.patch";
}
