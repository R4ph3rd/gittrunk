import type { ReactNode } from "react";
import { useLayout } from "@/app/layout/useLayout";

/**
 * Body of an AI dialog. On regular layouts it is a plain fragment (desktop DOM unchanged); on
 * compact layouts it spaces the parts and insets everything except the header and the sticky
 * footer, which manage their own padding inside a `Sheet`.
 */
export function SheetBody({ children }: { children: ReactNode }) {
  const { isCompact } = useLayout();
  if (!isCompact) return <>{children}</>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 [&>*:not(:first-child):not(.sticky)]:mx-4">
      {children}
    </div>
  );
}
