import {
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import { Avatar } from "@/design/components";
import type { ForgePull, PullBranch } from "@/ipc/bindings";
import { useAvatar, useRefColors } from "@/ipc/queries";
import { cn } from "@/lib/cn";
import { laneVar } from "@/lib/laneColor";

export const NO_REMOTE = "Pull requests need a GitHub remote";
export const UNSUPPORTED = "GitLab merge requests are not supported yet";

/** Head or base branch as a mono chip, in the branch's lane color when known (never for forks). */
export function BranchChip({
  repoId,
  branch,
  remote,
}: {
  repoId: string;
  branch: PullBranch;
  remote: string;
}) {
  const colors = useRefColors(repoId);
  const color = branch.isFork
    ? undefined
    : (colors.get(`refs/heads/${branch.name}`) ??
      colors.get(`refs/remotes/${remote}/${branch.name}`));
  return (
    <span
      title={branch.label}
      style={
        color === undefined ? undefined : { color: laneVar(color), borderColor: laneVar(color) }
      }
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm border px-1.5 font-mono text-xs",
        color === undefined && "border-border text-fg-muted",
      )}
    >
      <GitBranch className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{branch.isFork ? branch.label : branch.name}</span>
    </span>
  );
}

type PullLike = Pick<ForgePull, "state" | "draft">;

function look(pull: PullLike) {
  if (pull.state === "merged") return { Icon: GitMerge, text: "", label: "Merged" };
  if (pull.state === "closed")
    return { Icon: GitPullRequestClosed, text: "text-danger", label: "Closed" };
  if (pull.draft) return { Icon: GitPullRequestDraft, text: "text-fg-muted", label: "Draft" };
  return { Icon: GitPullRequest, text: "text-success", label: "Open" };
}

const MERGED_STYLE = { color: "var(--lane-3)" };

export function PullStateIcon({ pull }: { pull: PullLike }) {
  const { Icon, text } = look(pull);
  return (
    <Icon
      aria-hidden
      className={cn("size-4 shrink-0", text)}
      style={pull.state === "merged" ? MERGED_STYLE : undefined}
    />
  );
}

export function PullStateBadge({ pull }: { pull: PullLike }) {
  const { text, label } = look(pull);
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-sm font-medium", text)}
      style={pull.state === "merged" ? MERGED_STYLE : undefined}
    >
      <PullStateIcon pull={pull} />
      {label}
    </span>
  );
}

/** Author avatar of a sidebar or list row. */
export function AuthorAvatar({ login, size = 16 }: { login: string; size?: number }) {
  const src = useAvatar({ kind: "githubLogin", login });
  return <Avatar name={login} src={src} size={size} />;
}
