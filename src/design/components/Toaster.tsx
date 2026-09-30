/* eslint-disable react-refresh/only-export-components */
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useLayout } from "@/app/layout/useLayout";
import { useTheme } from "../theme";

/** On compact, toasts sit above the bottom nav and the bottom safe area. */
const COMPACT_OFFSET = "calc(var(--bottomnav-h) + var(--safe-bottom))";

export { toast } from "sonner";

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  const { isCompact } = useLayout();
  const offsets = isCompact ? { offset: COMPACT_OFFSET, mobileOffset: COMPACT_OFFSET } : {};
  return (
    <Sonner
      theme={resolvedTheme}
      // Bottom-center keeps toasts clear of the commit box and panel actions on the right.
      position="bottom-center"
      style={{ zIndex: "var(--z-toast)" } as CSSProperties}
      {...offsets}
      toastOptions={{
        classNames: {
          toast:
            "!bg-surface-raised !text-fg !border !border-border !shadow-md !rounded-md !text-base",
          description: "!text-fg-muted",
          actionButton: "!bg-accent !text-accent-fg",
          cancelButton: "!bg-surface-hover !text-fg-muted",
        },
      }}
      {...props}
    />
  );
}
