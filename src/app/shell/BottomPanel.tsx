import { lazy, Suspense } from "react";
import { Spinner } from "@/design/components";

const TerminalPanel = lazy(() =>
  import("@/features/terminal/TerminalPanel").then((m) => ({ default: m.TerminalPanel })),
);

/** Bottom panel of the center column: the terminal (its session survives unmounting). */
export function BottomPanel({ repoId, cwd }: { repoId: string; cwd: string }) {
  return (
    <div className="h-full min-h-0 border-t border-border bg-surface">
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <TerminalPanel repoId={repoId} cwd={cwd} />
      </Suspense>
    </div>
  );
}
