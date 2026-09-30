import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Separator } from "./Separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./Sheet";
import { focusRing, transition } from "./shared";

export interface ActionSheetItem {
  id: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Rows are `--touch-target-row` high; destructive rows use `--danger`. */
  items: ActionSheetItem[];
  /** Alternative to `items`: rendered with separators between groups. */
  groups?: ActionSheetItem[][];
  cancelLabel?: string;
}

const row = cn(
  "flex min-h-[var(--touch-target-row)] w-full items-center gap-3 rounded-md px-3 text-left text-base text-fg hover:bg-surface-hover active:bg-surface-hover disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted",
  focusRing,
  transition,
);

/** Selecting a row closes the sheet, then calls its `onSelect`. */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  description,
  items,
  groups,
  cancelLabel = "Cancel",
}: ActionSheetProps) {
  const sections = groups ?? [items];
  const select = (item: ActionSheetItem) => {
    onOpenChange(false);
    item.onSelect();
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent {...(description ? {} : { "aria-describedby": undefined })}>
        <SheetHeader>
          <SheetTitle className="text-base">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="flex flex-col gap-1 px-2 pb-2">
          {sections.map((section, gi) => (
            <Fragment key={gi}>
              {gi > 0 ? <Separator className="my-1" /> : null}
              {section.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled}
                  data-destructive={item.destructive || undefined}
                  onClick={() => select(item)}
                  className={cn(row, item.destructive && "text-danger [&_svg]:text-danger")}
                >
                  {item.icon}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{item.label}</span>
                    {item.description ? (
                      <span className="truncate text-sm text-fg-muted">{item.description}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </Fragment>
          ))}
          <Separator className="my-1" />
          <SheetClose className={cn(row, "justify-center font-medium")}>{cancelLabel}</SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
