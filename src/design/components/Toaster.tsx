/* eslint-disable react-refresh/only-export-components */
import type { CSSProperties } from "react";
import { Toaster as Sonner, toast as sonnerToast, type ToasterProps } from "sonner";
import { useLayout } from "@/app/layout/useLayout";
import { useNotificationsStore, type NotificationLevel } from "@/stores/notifications";
import { useTheme } from "../theme";

/** On compact, toasts sit above the bottom nav and the bottom safe area. */
const COMPACT_OFFSET = "calc(var(--bottomnav-h) + var(--safe-bottom))";

type Args = Parameters<typeof sonnerToast>;

/** Records string toasts in the notifications store; JSX messages are not recorded. */
function record(level: NotificationLevel, message: unknown, data: unknown): void {
  if (typeof message !== "string") return;
  const description = (data as { description?: unknown } | undefined)?.description;
  useNotificationsStore.getState().push({
    level,
    title: message,
    detail: typeof description === "string" ? description : null,
  });
}

/** Methods are resolved on sonner at call time so tests can replace the module. */
function levelMethod(name: "success" | "error" | "warning" | "info" | "message") {
  return (...args: Args) => {
    record(name === "message" ? "info" : name, args[0], args[1]);
    return (sonnerToast[name] as (...a: Args) => ReturnType<typeof sonnerToast>)(...args);
  };
}

function forward(name: "dismiss" | "loading" | "promise" | "custom") {
  return (...args: unknown[]) => (sonnerToast[name] as (...a: unknown[]) => unknown)(...args);
}

/** sonner's toast, additionally recording each string toast as an app notification. */
export const toast: typeof sonnerToast = Object.assign(
  (...args: Args) => {
    record("info", args[0], args[1]);
    return sonnerToast(...args);
  },
  {
    success: levelMethod("success"),
    error: levelMethod("error"),
    warning: levelMethod("warning"),
    info: levelMethod("info"),
    message: levelMethod("message"),
    dismiss: forward("dismiss"),
    loading: forward("loading"),
    promise: forward("promise"),
    custom: forward("custom"),
    getHistory: () => sonnerToast.getHistory(),
    getToasts: () => sonnerToast.getToasts(),
  },
) as unknown as typeof sonnerToast;

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
