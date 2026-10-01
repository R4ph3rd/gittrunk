import { useForgeStatus } from "@/ipc/queries";

export type ForgeGate =
  | { state: "loading" }
  | { state: "error"; error: unknown; retry: () => void }
  | { state: "noRemote" }
  | { state: "unsupported" }
  | { state: "ready"; canWrite: boolean; host: string };

export const NO_REMOTE_TEXT = "Issues need a GitHub remote";
export const UNSUPPORTED_TEXT = "GitLab issues are not supported yet";
export const GITHUB_HOST = "github.com";

/** What the forge features may do for a repository, from `forge_status`. */
export function useForgeGate(repoId: string): ForgeGate {
  const status = useForgeStatus(repoId);
  if (status.isPending) return { state: "loading" };
  if (status.isError) {
    return { state: "error", error: status.error, retry: () => void status.refetch() };
  }
  const { repo, supported, tokenSource } = status.data;
  if (!repo) return { state: "noRemote" };
  if (!supported || repo.kind !== "github") return { state: "unsupported" };
  return { state: "ready", canWrite: tokenSource !== "none", host: repo.host };
}
