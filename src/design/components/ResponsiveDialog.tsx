import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps, HTMLAttributes } from "react";
import { useLayout } from "@/app/layout/useLayout";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./Dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./Sheet";

/**
 * Dialog on regular layouts, bottom `Sheet` (snap "full" unless overridden) on compact.
 * Same API as `Dialog*`; on regular the DOM and classes are exactly what `Dialog*` renders.
 * Both branches register on the Android back stack (via `Sheet`'s root).
 */
export function ResponsiveDialog(props: DialogPrimitive.DialogProps) {
  return <Sheet {...props} />;
}

export const ResponsiveDialogTrigger = DialogPrimitive.Trigger;
export const ResponsiveDialogClose = DialogPrimitive.Close;

export function ResponsiveDialogContent({
  hideClose,
  snap = "full",
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  hideClose?: boolean;
  snap?: "auto" | "full";
}) {
  const { isCompact } = useLayout();
  if (isCompact) {
    return (
      <SheetContent snap={snap} {...props}>
        {children}
      </SheetContent>
    );
  }
  return (
    <DialogContent hideClose={hideClose} {...props}>
      {children}
    </DialogContent>
  );
}

export function ResponsiveDialogHeader(props: HTMLAttributes<HTMLDivElement>) {
  const { isCompact } = useLayout();
  return isCompact ? <SheetHeader {...props} /> : <DialogHeader {...props} />;
}

export function ResponsiveDialogFooter(props: HTMLAttributes<HTMLDivElement>) {
  const { isCompact } = useLayout();
  return isCompact ? <SheetFooter {...props} /> : <DialogFooter {...props} />;
}

export function ResponsiveDialogTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
  const { isCompact } = useLayout();
  return isCompact ? <SheetTitle {...props} /> : <DialogTitle {...props} />;
}

export function ResponsiveDialogDescription(
  props: ComponentProps<typeof DialogPrimitive.Description>,
) {
  const { isCompact } = useLayout();
  return isCompact ? <SheetDescription {...props} /> : <DialogDescription {...props} />;
}
