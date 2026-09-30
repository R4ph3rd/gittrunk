import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { focusRing, transition } from "./shared";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-border-strong bg-surface-hover data-[state=checked]:border-transparent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
        focusRing,
        transition,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3 translate-x-0.5 rounded-full bg-fg shadow-sm transition-transform duration-[var(--duration-fast)] ease-standard data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-accent-fg" />
    </SwitchPrimitive.Root>
  );
}
