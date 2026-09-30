import { useStatus } from "@/ipc/queries";

/** Files with uncommitted changes (conflicted count as unstaged); zeros while status loads. */
export function useWipCount(repoId: string): { staged: number; unstaged: number } {
  const data = useStatus(repoId).data;
  return {
    staged: data?.staged.length ?? 0,
    unstaged: (data?.unstaged.length ?? 0) + (data?.conflicted.length ?? 0),
  };
}
