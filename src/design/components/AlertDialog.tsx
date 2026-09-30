import * as AlertPrimitive from "@radix-ui/react-alert-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { fadeIn, modal, overlay, popIn } from "./shared";

export interface AlertDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional trigger element (rendered with asChild). */
  trigger?: ReactNode;
  title: string;
  description: ReactNode;
  /** Preview of what will be affected (e.g. a list of files or commits). */
  preview?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

export function AlertDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  preview,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
  onCancel,
}: AlertDialogProps) {
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertPrimitive.Trigger asChild>{trigger}</AlertPrimitive.Trigger> : null}
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className={cn(overlay, fadeIn)} />
        <AlertPrimitive.Content className={cn(modal, popIn)}>
          <AlertPrimitive.Title className="text-lg font-semibold">{title}</AlertPrimitive.Title>
          <AlertPrimitive.Description className="mt-1 text-base text-fg-muted">
            {description}
          </AlertPrimitive.Description>
          {preview ? (
            <div className="mt-3 max-h-40 overflow-auto rounded-md border border-border bg-bg-subtle p-2 font-mono text-sm">
              {preview}
            </div>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <AlertPrimitive.Cancel asChild>
              <Button variant="secondary" onClick={onCancel}>
                {cancelLabel}
              </Button>
            </AlertPrimitive.Cancel>
            <AlertPrimitive.Action asChild>
              <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertPrimitive.Action>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}
