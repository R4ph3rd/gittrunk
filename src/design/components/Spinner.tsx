import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn("size-3.5 animate-spin text-fg-muted motion-reduce:animate-none", className)}
    />
  );
}
