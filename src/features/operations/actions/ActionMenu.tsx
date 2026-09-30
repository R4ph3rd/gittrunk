import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/design/components";
import { useDndStore } from "@/stores/dnd";
import { buildActionEntries } from "./entries";
import { useActionContext } from "./useActionContext";
import type { ActionEntry, ActionTarget } from "./types";

function icon(entry: Extract<ActionEntry, { kind: "item" }>) {
  const Icon = entry.icon;
  return Icon ? <Icon /> : undefined;
}

/** Entries rendered inside a Radix context menu (sidebar items). */
export function ContextEntries({ entries }: { entries: ActionEntry[] }) {
  return entries.map((e, i) =>
    e.kind === "separator" ? (
      <ContextMenuSeparator key={`sep-${i}`} />
    ) : e.kind === "label" ? (
      <ContextMenuLabel key={`label-${e.label}`}>{e.label}</ContextMenuLabel>
    ) : (
      <ContextMenuItem
        key={e.id}
        icon={icon(e)}
        destructive={e.destructive}
        disabled={e.disabled}
        onSelect={() => e.run()}
      >
        {e.label}
      </ContextMenuItem>
    ),
  );
}

/** Menu entries for a target, built when a context menu opens (mounted lazily by Radix). */
export function TargetEntries({ repoId, target }: { repoId: string; target: ActionTarget }) {
  const makeContext = useActionContext(repoId);
  return <ContextEntries entries={buildActionEntries(target, makeContext())} />;
}

/**
 * One menu anchored at a viewport point: the drop menu ("Merge x into y") and the graph's context
 * menu. Mount once (the provider does).
 */
export function ActionMenuHost() {
  const menu = useDndStore((s) => s.menu);
  const close = useDndStore((s) => s.closeMenu);
  return (
    <DropdownMenu
      open={menu !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-px"
          style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={menu?.title}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {menu?.title ? <DropdownMenuLabel>{menu.title}</DropdownMenuLabel> : null}
        {menu?.entries.map((e, i) =>
          e.kind === "separator" ? (
            <DropdownMenuSeparator key={`sep-${i}`} />
          ) : e.kind === "label" ? (
            <DropdownMenuLabel key={`label-${e.label}`}>{e.label}</DropdownMenuLabel>
          ) : (
            <DropdownMenuItem
              key={e.id}
              icon={icon(e)}
              destructive={e.destructive}
              disabled={e.disabled}
              onSelect={() => e.run()}
            >
              {e.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
