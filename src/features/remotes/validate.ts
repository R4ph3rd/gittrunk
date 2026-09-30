const NAME_RE = /^[A-Za-z0-9._-]+$/;

export function validateRemoteName(name: string): string | null {
  if (name.length === 0) return "Enter a name";
  if (!NAME_RE.test(name)) return "Use letters, digits, dot, dash and underscore only";
  if (name.startsWith("-")) return "The name cannot start with a dash";
  return null;
}

export const HTTPS_ONLY_MESSAGE = "Use an HTTPS URL and a personal access token";

/** With `httpsOnly` (no SSH on this platform) anything but an `https://` URL is rejected. */
export function validateRemoteUrl(url: string, opts: { httpsOnly?: boolean } = {}): string | null {
  if (url.trim().length === 0) return "Enter a URL";
  if (url.trim().startsWith("-")) return "The URL cannot start with a dash";
  if (opts.httpsOnly && !/^https:\/\/[^/\s]+/i.test(url.trim())) return HTTPS_ONLY_MESSAGE;
  return null;
}

/** `https://user@host:443/x` becomes `host:443`; null when it is not a URL. */
export function hostOfUrl(url: string): string | null {
  try {
    return new URL(url.trim()).host || null;
  } catch {
    return null;
  }
}

/** `https://host/acme/demo.git` or `git@host:acme/demo.git` becomes `demo`. */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[/\\]+$/, "");
  const last = trimmed.split(/[/\\:]/).pop() ?? "";
  return last.replace(/\.git$/, "");
}

/** Joins a parent folder and a name using the separator the parent already uses. */
export function joinPath(parent: string, name: string): string {
  if (!parent) return "";
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  const base = parent.replace(/[/\\]+$/, "");
  return name ? `${base}${sep}${name}` : base;
}
