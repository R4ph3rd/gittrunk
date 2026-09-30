import type { ComponentProps } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "@/lib/cn";
import { focusRing, transition } from "./shared";

export function ResizablePanelGroup(props: ComponentProps<typeof Group>) {
  return <Group {...props} />;
}

export const ResizablePanel = Panel;

/** 1px handle with a wider invisible hit area; highlights on hover, drag and focus. */
export function ResizableHandle({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        "relative w-px shrink-0 bg-border hover:bg-accent data-[separator=active]:bg-accent aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full after:absolute after:-inset-x-1 after:inset-y-0 aria-[orientation=horizontal]:after:-inset-y-1 aria-[orientation=horizontal]:after:inset-x-0",
        focusRing,
        transition,
        className,
      )}
      {...props}
    />
  );
}
