import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { focusRing, transition } from "./shared";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex h-[var(--control-lg)] items-end gap-1 border-b border-border",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px inline-flex h-[var(--control-md)] items-center rounded-t-sm border-b-2 border-transparent px-2 text-base text-fg-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg disabled:opacity-50",
        focusRing,
        transition,
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("pt-3", focusRing, className)} {...props} />;
}
