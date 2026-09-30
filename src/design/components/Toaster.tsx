/* eslint-disable react-refresh/only-export-components */
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "../theme";

export { toast } from "sonner";

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme}
      style={{ zIndex: "var(--z-toast)" } as CSSProperties}
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
