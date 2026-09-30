import * as ContextPrimitive from "@radix-ui/react-context-menu";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { floating, menuItem, popIn } from "./shared";

const content = cn(floating, popIn, "z-[var(--z-dropdown)] min-w-40 p-1");
const separator = "-mx-1 my-1 h-px bg-border";
const label = "px-2 py-1 text-xs font-medium text-fg-subtle";
const danger = "text-danger data-[highlighted]:bg-danger/10 [&_svg]:text-danger";

interface ItemExtras {
  icon?: ReactNode;
  shortcut?: string;
  destructive?: boolean;
}

function Shortcut({ children }: { children: ReactNode }) {
  return <span className="ml-auto pl-4 font-mono text-xs text-fg-subtle">{children}</span>;
}

/* DropdownMenu */
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuGroup = DropdownPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        className={cn(content, className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  icon,
  shortcut,
  destructive,
  children,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Item> & ItemExtras) {
  return (
    <DropdownPrimitive.Item className={cn(menuItem, destructive && danger, className)} {...props}>
      {icon}
      {children}
      {shortcut ? <Shortcut>{shortcut}</Shortcut> : null}
    </DropdownPrimitive.Item>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn(label, className)} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Separator>) {
  return <DropdownPrimitive.Separator className={cn(separator, className)} {...props} />;
}

/* ContextMenu */
export const ContextMenu = ContextPrimitive.Root;
export const ContextMenuTrigger = ContextPrimitive.Trigger;
export const ContextMenuGroup = ContextPrimitive.Group;

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextPrimitive.Content>) {
  return (
    <ContextPrimitive.Portal>
      <ContextPrimitive.Content className={cn(content, className)} {...props} />
    </ContextPrimitive.Portal>
  );
}

export function ContextMenuItem({
  className,
  icon,
  shortcut,
  destructive,
  children,
  ...props
}: ComponentProps<typeof ContextPrimitive.Item> & ItemExtras) {
  return (
    <ContextPrimitive.Item className={cn(menuItem, destructive && danger, className)} {...props}>
      {icon}
      {children}
      {shortcut ? <Shortcut>{shortcut}</Shortcut> : null}
    </ContextPrimitive.Item>
  );
}

export function ContextMenuLabel({
  className,
  ...props
}: ComponentProps<typeof ContextPrimitive.Label>) {
  return <ContextPrimitive.Label className={cn(label, className)} {...props} />;
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextPrimitive.Separator>) {
  return <ContextPrimitive.Separator className={cn(separator, className)} {...props} />;
}
