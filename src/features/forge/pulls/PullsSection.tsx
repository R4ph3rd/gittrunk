import type { ReactNode } from "react";
import { Badge } from "@/design/components";
import { Item, Section } from "@/features/repo/SidebarParts";
import { usePulls } from "@/ipc/queries";
import { openPull, openPulls } from "@/stores/workspace";
import { useForgeGate } from "../gate";
import { ForgeError } from "../parts";
import { AuthorAvatar, NO_REMOTE, UNSUPPORTED } from "./parts";

const SIDEBAR_LIMIT = 10;

function Line({ children }: { children: ReactNode }) {
  return <li className="px-6 py-1 text-xs text-fg-muted">{children}</li>;
}

/** Sidebar section listing the first open pull requests of the GitHub origin. Never polls. */
export function PullsSection({ repoId }: { repoId: string }) {
  const gate = useForgeGate(repoId);
  const ready = gate.state === "ready";
  // Fetches once per stale period, also while the section is collapsed (the query lives here).
  const pulls = usePulls(repoId, "open", { enabled: ready });
  const items = (pulls.data?.pages[0]?.items ?? []).slice(0, SIDEBAR_LIMIT);
  const count = pulls.data?.pages.flatMap((p) => p.items).length ?? 0;

  let body: ReactNode;
  if (gate.state === "loading") body = <Line>Loading pull requests…</Line>;
  else if (gate.state === "noRemote") body = <Line>{NO_REMOTE}</Line>;
  else if (gate.state === "unsupported") body = <Line>{UNSUPPORTED}</Line>;
  else if (gate.state === "error")
    body = (
      <li className="px-6 py-1">
        <ForgeError error={gate.error} onRetry={gate.retry} />
      </li>
    );
  else if (pulls.isPending) body = <Line>Loading pull requests…</Line>;
  else if (pulls.isError)
    body = (
      <li className="px-6 py-1">
        <ForgeError error={pulls.error} onRetry={() => void pulls.refetch()} />
      </li>
    );
  else
    body = (
      <>
        {items.length === 0 ? <Line>No open pull requests</Line> : null}
        {items.map((pull) => (
          <Item
            key={pull.number}
            label={`#${pull.number} ${pull.title}`}
            leading={<AuthorAvatar login={pull.author.login} />}
            // The sidebar is too narrow for a branch chip and a readable title; the
            // head branch is in the tooltip and shown as a chip in the detail view.
            title={`#${pull.number} ${pull.title}\n${pull.head}`}
            badges={pull.draft ? <Badge>Draft</Badge> : undefined}
            onClick={() => openPull(repoId, pull.number)}
          />
        ))}
        <Item label="Show all pull requests" onClick={() => openPulls(repoId)} />
      </>
    );

  return (
    <Section title="Pull requests" count={count}>
      {body}
    </Section>
  );
}
