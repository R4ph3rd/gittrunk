import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Kbd } from "./Kbd";
import { floating, popIn } from "./shared";

export function TooltipProvider({
  delayDuration = 400,
  ...props
}: TooltipPrimitive.TooltipProviderProps) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

export interface TooltipProps {
  content: ReactNode;
  /** Shortcut hint shown as a Kbd next to the content. */
  shortcut?: string;
  side?: TooltipPrimitive.TooltipContentProps["side"];
  children: ReactNode;
  className?: string;
}

export function Tooltip({ content, shortcut, side = "top", children, className }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            floating,
            popIn,
            "z-[var(--z-tooltip)] flex items-center gap-2 px-2 py-1 text-sm",
            className,
          )}
        >
          {content}
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
