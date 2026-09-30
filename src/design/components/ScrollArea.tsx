import * as ScrollPrimitive from "@radix-ui/react-scroll-area";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function ScrollArea({
  className,
  children,
  ...props
}: ComponentProps<typeof ScrollPrimitive.Root>) {
  return (
    <ScrollPrimitive.Root className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollPrimitive.Viewport className="size-full rounded-[inherit]">
        {children}
      </ScrollPrimitive.Viewport>
      {(["vertical", "horizontal"] as const).map((orientation) => (
        <ScrollPrimitive.Scrollbar
          key={orientation}
          orientation={orientation}
          className={cn(
            "flex touch-none select-none p-px",
            orientation === "vertical" ? "h-full w-2 flex-col" : "h-2 flex-col",
          )}
        >
          <ScrollPrimitive.Thumb className="relative flex-1 rounded-full bg-[color:var(--scrollbar-thumb)] hover:bg-[color:var(--scrollbar-thumb-hover)]" />
        </ScrollPrimitive.Scrollbar>
      ))}
      <ScrollPrimitive.Corner />
    </ScrollPrimitive.Root>
  );
}
