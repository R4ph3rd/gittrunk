import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useLayout } from "@/app/layout/useLayout";
import { Kbd } from "./Kbd";
import { Sheet, SheetContent, SheetTitle } from "./Sheet";
import { fadeIn, floating, overlay, popIn } from "./shared";

export interface CommandItemDef {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  /** Extra search terms. */
  keywords?: string[];
  onSelect: () => void;
}

export interface CommandGroupDef {
  heading: string;
  items: CommandItemDef[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: CommandGroupDef[];
  placeholder?: string;
  emptyText?: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  groups,
  placeholder = "Type a command or search...",
  emptyText = "No results found.",
}: CommandPaletteProps) {
  const { isCompact, isCoarse } = useLayout();
  const command = (
    <Command
      loop
      label="Command palette"
      className={isCompact ? "flex min-h-0 flex-1 flex-col" : undefined}
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
        <Command.Input
          placeholder={placeholder}
          className="h-10 w-full bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      <Command.List className={cn(isCompact ? "min-h-0 flex-1" : "max-h-80", "overflow-auto p-1")}>
        <Command.Empty className="px-2 py-6 text-center text-base text-fg-muted">
          {emptyText}
        </Command.Empty>
        {groups.map((group) => (
          <Command.Group
            key={group.heading}
            heading={group.heading}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle"
          >
            {group.items.map((item) => (
              <Command.Item
                key={item.id}
                value={item.label}
                keywords={item.keywords}
                onSelect={() => {
                  item.onSelect();
                  onOpenChange(false);
                }}
                className="flex h-[var(--control-md)] cursor-default items-center gap-2 rounded-sm px-2 text-base text-fg data-[selected=true]:bg-surface-hover data-[disabled=true]:opacity-50 [&_svg]:size-3.5 [&_svg]:text-fg-muted"
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
                {item.shortcut && !isCoarse ? <Kbd className="ml-auto">{item.shortcut}</Kbd> : null}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command>
  );

  if (isCompact) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent snap="full" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Command palette</SheetTitle>
          {command}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(overlay, fadeIn)} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            floating,
            popIn,
            "fixed left-1/2 top-[15vh] z-[var(--z-modal)] w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg shadow-lg",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          {command}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
