import type { StatusSnapshot } from "@/ipc/bindings";
import type { OpenFile } from "./FileList";

/** The file whose diff is shown: follows a file when it moves between staged and unstaged. */
export function effectiveOpen(open: OpenFile | null, status: StatusSnapshot): OpenFile | null {
  if (!open) return null;
  const inList = (files: { path: string }[]) => files.some((f) => f.path === open.path);
  const here = open.staged ? status.staged : [...status.unstaged, ...status.conflicted];
  if (inList(here)) return open;
  const other = open.staged ? [...status.unstaged, ...status.conflicted] : status.staged;
  return inList(other) ? { path: open.path, staged: !open.staged } : null;
}
