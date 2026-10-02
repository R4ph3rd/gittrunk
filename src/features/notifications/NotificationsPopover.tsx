import { useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  CircleAlert,
  CircleCheck,
  CircleDot,
  GitCommitHorizontal,
  GitPullRequest,
  Info,
  Tag,
  TriangleAlert,
} from "lucide-react";
import {
  Button,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@/design/components";
import { cn } from "@/lib/cn";
import { useForgeNotifications, useForgeTokenSource, openUrl } from "@/ipc/queries";
import type { ForgeNotification } from "@/ipc/bindings";
import { GITHUB_HOST } from "@/features/forge/gate";
import { errorMessage, useOpenIntegrations } from "@/features/forge/helpers";
import { relativeDate } from "@/features/graph/format";
import {
  useNotificationsStore,
  type AppNotification,
  type NotificationLevel,
} from "@/stores/notifications";

const GITHUB_NOTIFICATIONS_URL = "https://github.com/notifications";

const LEVEL: Record<NotificationLevel, { icon: ReactNode; label: string; tone: string }> = {
  success: { icon: <CircleCheck />, label: "Success", tone: "text-success" },
  error: { icon: <CircleAlert />, label: "Error", tone: "text-danger" },
  warning: { icon: <TriangleAlert />, label: "Warning", tone: "text-warning" },
  info: { icon: <Info />, label: "Info", tone: "text-fg-muted" },
};

const KIND_ICON: Record<string, ReactNode> = {
  PullRequest: <GitPullRequest />,
  Issue: <CircleDot />,
  Commit: <GitCommitHorizontal />,
  Release: <Tag />,
};

const rowClass =
  "flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left last:border-b-0";
const iconClass = "mt-0.5 size-4 shrink-0 [&_svg]:size-4";
const bodyClass = "max-h-[min(28rem,70vh)] overflow-y-auto";

function ActivityRow({ item, fresh }: { item: AppNotification; fresh: boolean }) {
  const meta = LEVEL[item.level];
  const when = relativeDate(Math.floor(item.at / 1000));
  return (
    <li className={rowClass}>
      <span className={cn(iconClass, meta.tone)}>
        {meta.icon}
        <span className="sr-only">{meta.label}</span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("break-words text-base text-fg", fresh && "font-medium")}>
          {item.title}
        </span>
        {item.detail ? (
          <span className="line-clamp-2 break-words text-sm text-fg-muted">{item.detail}</span>
        ) : null}
        <span className="text-xs text-fg-muted">
          {[item.source, when].filter(Boolean).join(" · ")}
        </span>
      </div>
    </li>
  );
}

function Activity() {
  const items = useNotificationsStore((s) => s.items);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const clear = useNotificationsStore((s) => s.clear);
  // Items that were unread when the popover opened stay emphasised; they are marked read after.
  const [fresh] = useState(() => new Set(items.filter((i) => !i.read).map((i) => i.id)));

  useEffect(() => {
    markAllRead();
  }, [markAllRead, items]);

  return (
    <>
      <div className={bodyClass}>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-base text-fg-muted">No activity yet</p>
        ) : (
          <ul aria-label="Activity">
            {items.map((item) => (
              <ActivityRow key={item.id} item={item} fresh={fresh.has(item.id)} />
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-2">
        <Button size="sm" disabled={items.length === 0} onClick={markAllRead}>
          Mark all read
        </Button>
        <Button size="sm" disabled={items.length === 0} onClick={clear}>
          Clear
        </Button>
      </div>
    </>
  );
}

function GithubRow({ item }: { item: ForgeNotification }) {
  const { url } = item;
  const body = (
    <>
      <span className={cn(iconClass, item.unread ? "text-accent" : "text-fg-muted")}>
        {KIND_ICON[item.kind] ?? <Bell />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("break-words text-base text-fg", item.unread && "font-medium")}>
          {item.title}
        </span>
        <span className="text-xs text-fg-muted">
          {[item.repo, item.reason, relativeDate(item.updatedAt)].filter(Boolean).join(" · ")}
        </span>
      </div>
      {item.unread ? <span className="sr-only">Unread</span> : null}
    </>
  );
  return (
    <li>
      {url ? (
        <button
          type="button"
          className={cn(
            rowClass,
            "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--focus-ring)]",
          )}
          onClick={() => {
            openUrl(url).catch((e: unknown) => toast.error(errorMessage(e)));
          }}
        >
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

function Github({ onClose }: { onClose: () => void }) {
  const source = useForgeTokenSource(GITHUB_HOST);
  const hasToken = source.data !== undefined && source.data !== "none";
  const query = useForgeNotifications(GITHUB_HOST, { enabled: hasToken });
  const openIntegrations = useOpenIntegrations();

  let body: ReactNode;
  if (source.data === undefined || (hasToken && query.isPending)) {
    body = <Spinner label="Loading notifications" className="mx-auto my-8" />;
  } else if (!hasToken) {
    body = (
      <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
        <p className="text-base text-fg-muted">Connect GitHub to see your notifications</p>
        <Button
          onClick={() => {
            onClose();
            openIntegrations();
          }}
        >
          Add a GitHub token
        </Button>
      </div>
    );
  } else if (query.isError) {
    body = (
      <p role="alert" className="px-3 py-6 text-base text-danger">
        {errorMessage(query.error)}
      </p>
    );
  } else if (query.data?.length === 0) {
    body = <p className="px-3 py-8 text-center text-base text-fg-muted">No notifications</p>;
  } else {
    body = (
      <ul aria-label="GitHub notifications">
        {query.data?.map((n) => (
          <GithubRow key={n.id} item={n} />
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className={bodyClass}>{body}</div>
      <div className="flex justify-end border-t border-border p-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            openUrl(GITHUB_NOTIFICATIONS_URL).catch((e: unknown) => toast.error(errorMessage(e)));
          }}
        >
          Open all on GitHub
        </Button>
      </div>
    </>
  );
}

/** Popover body: app activity and GitHub notifications. Mounted only while open. */
export function NotificationsPopover({
  githubUnread,
  onClose,
}: {
  githubUnread: number;
  onClose: () => void;
}) {
  return (
    <Tabs defaultValue="activity">
      <TabsList className="w-full px-2">
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="github">
          GitHub{githubUnread > 0 ? ` (${githubUnread})` : ""}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="activity" className="pt-0">
        <Activity />
      </TabsContent>
      <TabsContent value="github" className="pt-0">
        <Github onClose={onClose} />
      </TabsContent>
    </Tabs>
  );
}
