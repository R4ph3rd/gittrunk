import type { ReactNode } from "react";
import * as HoverCard from "@radix-ui/react-hover-card";
import { Copy } from "lucide-react";
import { Avatar, IconButton, toast } from "@/design/components";
import type { GraphRow } from "@/ipc/bindings";
import { useAvatar, useCommitDetails } from "@/ipc/queries";
import { laneVar } from "@/lib/laneColor";
import { useDndStore } from "@/stores/dnd";
import { absoluteDate, relativeDate } from "./format";
import { RefBadge } from "./RefBadge";

export const HOVER_OPEN_DELAY = 500;
export const HOVER_CLOSE_DELAY = 150;

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={mono ? "select-text break-all font-mono text-xs" : "select-text"}>
        {value}
      </span>
      <IconButton
        aria-label={`Copy ${label}`}
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          toast("Copied");
        }}
      >
        <Copy />
      </IconButton>
    </div>
  );
}

function CardBody({ repoId, row }: { repoId: string; row: GraphRow }) {
  const details = useCommitDetails(repoId, row.oid);
  const avatar = useAvatar({ kind: "email", email: row.authorEmail });
  const body = details.data?.body.trim();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <Avatar name={row.authorName} src={avatar} size={28} color={laneVar(row.color)} ring />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{row.authorName}</span>
          <span className="truncate text-xs text-fg-muted">{row.authorEmail}</span>
        </div>
      </div>
      <div className="text-fg-muted">
        <span>{absoluteDate(row.authorTime)}</span>
        <span className="text-fg-subtle"> ({relativeDate(row.authorTime)})</span>
      </div>
      <div className="flex flex-col gap-0.5 text-fg-subtle">
        <CopyRow label="short commit id" value={row.shortOid} mono />
        <CopyRow label="full commit id" value={row.oid} mono />
      </div>
      <div className="max-h-48 select-text overflow-y-auto whitespace-pre-wrap border-t border-border pt-2">
        <span className="font-semibold">{details.data?.summary ?? row.summary}</span>
        {body ? `\n\n${body}` : null}
      </div>
      {row.refs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.refs.map((l) => (
            <RefBadge key={l.fullName} label={l} color={row.color} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Wraps a graph row: after a hover delay (or when `open` is forced) shows the commit details. */
export function CommitHoverCard({
  repoId,
  row,
  open,
  onOpenChange,
  children,
}: {
  repoId: string;
  row: GraphRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const dragging = useDndStore((s) => s.drag !== null);
  return (
    <HoverCard.Root
      open={open && !dragging}
      onOpenChange={onOpenChange}
      openDelay={HOVER_OPEN_DELAY}
      closeDelay={HOVER_CLOSE_DELAY}
    >
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label="Commit summary"
          className="z-[var(--z-popover)] w-[420px] max-w-[min(420px,calc(100vw-16px))] rounded-md border border-border bg-surface-raised p-3 text-fg shadow-md"
        >
          <CardBody repoId={repoId} row={row} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
