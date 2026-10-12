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

export interface RepoUrl {
  host: string;
  owner: string;
  name: string;
}

const URL_RE =
  /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;
const SCP_RE = /^[^@/\s]+@([^:/\s]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

/** `host/owner/name` of an https, ssh:// or scp-style remote URL; null for local paths and odd shapes. */
export function parseRepoUrl(url: string): RepoUrl | null {
  const u = url.trim();
  const m = URL_RE.exec(u) ?? SCP_RE.exec(u);
  if (!m) return null;
  return { host: m[1]!.toLowerCase(), owner: m[2]!, name: m[3]! };
}

/** A repository name GitHub accepts, derived from a folder name. */
export function suggestRepoName(folder: string): string {
  const cleaned = folder
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.replace(/\.git$/, "");
}

export function validateRepoName(name: string): string | null {
  if (name.length === 0) return "Enter a repository name";
  if (!NAME_RE.test(name) || name === "." || name === "..") {
    return "Use letters, digits, dot, dash and underscore only";
  }
  if (name.endsWith(".git")) return "The name cannot end with .git";
  return null;
}
