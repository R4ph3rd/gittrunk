import { useQuery } from "@tanstack/react-query";
import { commands } from "./bindings";
import { unwrap } from "./client";

/** Query keys are scoped by repo id so `repo-changed` events can invalidate precisely. */
export const queryKeys = {
  appInfo: ["appInfo"] as const,
};

export function useAppInfo() {
  return useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: () => unwrap(commands.appInfo()),
    staleTime: Infinity,
  });
}
