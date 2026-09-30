import { MoreVertical } from "lucide-react";
import { IconButton, ListRow } from "@/design/components";
import type { RecentRepo } from "@/ipc/bindings";
import { truncateMiddle } from "./recentPaths";
import { useRecentDelete } from "./useRecentDelete";

/** Recent repositories as touch rows with a trailing overflow button when deletable. */
export function RecentRepoRows({
  repos,
  onOpen,
}: {
  repos: RecentRepo[];
  onOpen: (path: string) => void;
}) {
  const { canDelete, openMenu, flow } = useRecentDelete();
  return (
    <>
      <ul aria-label="Recent repositories" className="flex flex-col">
        {repos.map((r) => (
          <li key={r.path} className="flex items-center">
            <ListRow
              className="min-w-0 flex-1"
              title={r.name}
              subtitle={<span className="font-mono text-xs">{truncateMiddle(r.path)}</span>}
              onClick={() => onOpen(r.path)}
            />
            {canDelete(r.path) ? (
              <IconButton
                aria-label={`Actions for ${r.name}`}
                size="md"
                onClick={() => openMenu(r)}
              >
                <MoreVertical />
              </IconButton>
            ) : null}
          </li>
        ))}
      </ul>
      {flow}
    </>
  );
}
