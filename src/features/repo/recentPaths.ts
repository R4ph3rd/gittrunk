/** Shortens a long path to `head…tail`, keeping the start and the repo folder visible. */
export function truncateMiddle(path: string, max = 44): string {
  if (path.length <= max) return path;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${path.slice(0, head)}…${path.slice(path.length - (keep - head))}`;
}

/** Only repositories inside the app-private repos folder may be deleted from the UI. */
export function isDeletablePath(path: string, defaultReposDir: string | null): boolean {
  if (!defaultReposDir) return false;
  const root = defaultReposDir.replace(/[\\/]+$/, "");
  return path.startsWith(`${root}/`) || path.startsWith(`${root}\\`);
}
