import { Construction } from "lucide-react";
import { EmptyState } from "@/design/components";
import { ShellAppBar } from "./ShellAppBar";

/** Shown for a route nobody has contributed a screen for yet. */
export function NotAvailableScreen({ repoId, name }: { repoId: string | null; name: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar repoId={repoId} back title="Not available" />
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={<Construction />}
          title="Not available on this device yet"
          description={`The "${name}" screen has no mobile version yet.`}
        />
      </div>
    </div>
  );
}
