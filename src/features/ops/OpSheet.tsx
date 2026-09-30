import { X } from "lucide-react";
import {
  IconButton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
} from "@/design/components";
import { cancelOp } from "./ops";
import { useVisibleOps } from "./store";

/** Expanded view of the running operations (tap the AppBar progress button to open). */
export function OpSheet({
  repoId,
  open,
  onOpenChange,
}: {
  repoId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ops = useVisibleOps(repoId);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Running operations</SheetTitle>
          <SheetDescription className="sr-only">
            Progress of fetch, pull, push and clone operations.
          </SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col gap-1 px-4 pb-3">
          {ops.length === 0 ? <li className="text-base text-fg-muted">Nothing running.</li> : null}
          {ops.map((op) => (
            <li
              key={op.id}
              data-testid="op-sheet-row"
              className="flex min-h-[var(--touch-target-row)] items-center gap-3"
            >
              <Spinner label={`${op.label} in progress`} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base">{op.label}</span>
                <span className="truncate text-sm text-fg-muted">
                  {op.message ?? op.phase}
                  {op.percent !== null ? ` ${Math.round(op.percent)}%` : ""}
                </span>
              </span>
              <IconButton aria-label={`Cancel ${op.label}`} onClick={() => void cancelOp(op.id)}>
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
