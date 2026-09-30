import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useBackHandler } from "@/app/layout/useBackHandler";
import { cn } from "@/lib/cn";
import { fadeIn, overlay } from "./shared";

/** Drag past this fraction of the sheet height to dismiss. */
const DISMISS_FRACTION = 0.3;
/** Release faster than this (px/ms) to dismiss. */
const DISMISS_VELOCITY = 0.5;

interface SheetContextValue {
  close: () => void;
}
const SheetContext = createContext<SheetContextValue | null>(null);

/**
 * Bottom sheet root on `@radix-ui/react-dialog`. Controlled or uncontrolled. While open it
 * registers on the Android back stack so back closes the sheet.
 */
export function Sheet({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: DialogPrimitive.DialogProps) {
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  const setOpen = useCallback(
    (next: boolean) => {
      setInner(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  useBackHandler(() => {
    setOpen(false);
    return true;
  }, open);
  const ctx = useMemo(() => ({ close: () => setOpen(false) }), [setOpen]);
  return (
    <SheetContext.Provider value={ctx}>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen} {...props} />
    </SheetContext.Provider>
  );
}

export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** `auto`: content height, max 85dvh (default). `full`: 100dvh minus the top safe area. */
  snap?: "auto" | "full";
  /** Drag the handle past 30% of the height, or faster than 0.5 px/ms, to close. Default true. */
  dragToDismiss?: boolean;
  hideHandle?: boolean;
}

function DragHandle({
  contentRef,
  draggable,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  draggable: boolean;
}) {
  const ctx = useContext(SheetContext);
  const start = useRef<{ y: number; t: number } | null>(null);
  const delta = useRef(0);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable) return;
    start.current = { y: e.clientY, t: Date.now() };
    delta.current = 0;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic pointer without an active id */
    }
    const el = contentRef.current;
    if (el) el.style.transition = "none";
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    const el = contentRef.current;
    if (!s || !el) return;
    delta.current = Math.max(0, e.clientY - s.y);
    el.style.transform = `translateY(${delta.current}px)`;
    el.style.setProperty("--sheet-drag", `${delta.current}px`);
  };

  const finish = (cancelled: boolean) => {
    const s = start.current;
    const el = contentRef.current;
    start.current = null;
    if (!s || !el) return;
    const dy = delta.current;
    const dt = Math.max(1, Date.now() - s.t);
    const height = el.getBoundingClientRect().height;
    const commit =
      !cancelled && dy > 0 && (dy > height * DISMISS_FRACTION || dy / dt > DISMISS_VELOCITY);
    if (commit) {
      ctx?.close();
      return;
    }
    el.style.transition = "transform var(--sheet-duration) var(--ease-standard)";
    el.style.transform = "";
    el.style.removeProperty("--sheet-drag");
  };

  return (
    <div
      data-sheet-handle=""
      aria-hidden
      className={cn(
        "flex h-3 shrink-0 items-center justify-center",
        draggable && "cursor-grab touch-none active:cursor-grabbing",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => finish(false)}
      onPointerCancel={() => finish(true)}
    >
      <div className="h-[var(--sheet-handle-h)] w-[var(--sheet-handle)] rounded-full bg-border-strong" />
    </div>
  );
}

export function SheetContent({
  className,
  children,
  snap = "auto",
  dragToDismiss = true,
  hideHandle,
  ...props
}: SheetContentProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn(overlay, fadeIn)} />
      <DialogPrimitive.Content
        ref={ref}
        data-snap={snap}
        className={cn(
          "fixed inset-x-0 bottom-0 z-[var(--z-modal)] flex flex-col overflow-hidden rounded-t-[var(--sheet-radius)] border border-b-0 border-border bg-surface-raised text-fg shadow-lg focus:outline-none",
          "animate-[ds-sheet-in_var(--sheet-duration)_var(--ease-standard)] data-[state=closed]:animate-[ds-sheet-out_var(--sheet-duration)_var(--ease-standard)_forwards]",
          snap === "full" ? "h-[calc(100dvh-var(--safe-top))]" : "max-h-[var(--sheet-max-h)]",
          className,
        )}
        {...props}
      >
        {hideHandle ? null : <DragHandle contentRef={ref} draggable={dragToDismiss} />}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain after:block after:h-[var(--safe-bottom)] after:shrink-0 after:content-['']">
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 px-4 pb-3 pt-1", className)} {...props} />;
}

/** Sticks to the bottom of the sheet body and pads the bottom safe area. */
export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "sticky bottom-0 -mb-[var(--safe-bottom)] mt-auto flex flex-col gap-2 border-t border-border bg-surface-raised px-4 pb-[calc(var(--safe-bottom)+var(--space-2))] pt-2",
        className,
      )}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />;
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn("text-base text-fg-muted", className)} {...props} />
  );
}
