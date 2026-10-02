import { useState } from "react";
import { Bell, BellDot } from "lucide-react";
import { IconButton, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/design/components";
import { GITHUB_HOST } from "@/features/forge/gate";
import { useForgeNotifications, useForgeTokenSource } from "@/ipc/queries";
import { useUnreadNotifications } from "@/stores/notifications";
import { NotificationsPopover } from "./NotificationsPopover";

/** Top-right notifications button: bell with an unread badge and the popover it opens. */
export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const appUnread = useUnreadNotifications();
  const source = useForgeTokenSource(GITHUB_HOST);
  const github = useForgeNotifications(GITHUB_HOST, {
    enabled: source.data !== undefined && source.data !== "none",
  });
  const githubUnread = github.data?.filter((n) => n.unread).length ?? 0;
  const unread = appUnread + githubUnread;
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Notifications">
        <PopoverTrigger asChild>
          <IconButton size="sm" aria-label={label} className="relative">
            {unread > 0 ? <BellDot /> : <Bell />}
            {unread > 0 ? (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium leading-none text-accent-fg"
              >
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </IconButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-96 p-0" aria-label="Notifications">
        <NotificationsPopover githubUnread={githubUnread} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
