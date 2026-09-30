import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useLayout } from "@/app/layout/useLayout";
import { Kbd } from "./Kbd";
import { floating, popIn } from "./shared";

const ProviderPresent = createContext(false);

/**
 * Optional: shares delay settings across tooltips. `Tooltip` also works without
 * it (it mounts its own provider when none is above it).
 */
export function TooltipProvider({
  delayDuration = 400,
  ...props
}: TooltipPrimitive.TooltipProviderProps) {
  return (
    <ProviderPresent.Provider value={true}>
      <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
    </ProviderPresent.Provider>
  );
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
  const hasProvider = useContext(ProviderPresent);
  const { isCoarse } = useLayout();
  // Touch has no hover: render only the trigger (its aria-label stays).
  if (isCoarse) return <>{children}</>;
  const tooltip = (
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
  return hasProvider ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>;
}
