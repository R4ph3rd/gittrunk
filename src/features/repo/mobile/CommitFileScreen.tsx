import { FileClock } from "lucide-react";
import type { RouteScreenProps } from "@/app/layout/registry";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import { usePlatform } from "@/app/platform";
import { IconButton } from "@/design/components";
import { useNav } from "@/stores/nav";
import { FileDiffView } from "../FileDiffView";

/** One file of a commit as a unified diff. */
export function CommitFileScreen({ repoId, route }: RouteScreenProps<"commitFile">) {
  const nav = useNav();
  const platform = usePlatform();
  const name = route.path.split("/").pop() ?? route.path;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <ShellAppBar
        repoId={repoId}
        back
        title={name}
        subtitle={`${route.oid.slice(0, 7)} · ${route.path}`}
        actions={
          platform.supportsFileHistory ? (
            <IconButton
              aria-label="File history"
              onClick={() => nav.push({ name: "fileHistory", path: route.path })}
            >
              <FileClock />
            </IconButton>
          ) : null
        }
      />
      <div data-scroll-root="" className="min-h-0 flex-1">
        <FileDiffView repoId={repoId} oid={route.oid} path={route.path} />
      </div>
    </div>
  );
}
