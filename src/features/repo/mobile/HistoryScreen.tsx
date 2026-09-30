import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, EllipsisVertical, Filter, RefreshCw, Search } from "lucide-react";
import type { TabScreenProps } from "@/app/layout/registry";
import { ShellAppBar } from "@/app/layout/ShellAppBar";
import {
  ActionSheet,
  IconButton,
  PullToRefresh,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/design/components";
import { FilterFields } from "@/features/graph/FilterPopover";
import { isFiltered } from "@/features/graph/filters";
import { GraphList } from "@/features/graph/GraphView";
import { COMPACT_METRICS, gutterWidth } from "@/features/graph/layout";
import { useGraphSearchState } from "@/features/graph/useGraphSearchState";
import { WipRow } from "@/features/graph/WipRow";
import { fetchRemote, pullCurrent, pushBranch } from "@/features/remotes/actions";
import { usePlatform } from "@/app/platform";
import { useGraphMeta, useRefs } from "@/ipc/queries";
import { useNav } from "@/stores/nav";
import { DEFAULT_FILTER, useRepoStore } from "@/stores/repo";

/** Phone History tab: two-line commit list with a lane gutter, search, filters, WIP row. */
export function HistoryScreen({ repoId }: TabScreenProps) {
  usePlatform(); // make sure capabilities are loaded before an action menu is built
  const nav = useNav();
  const client = useQueryClient();
  const filter = useRepoStore((s) => s.filters[repoId]) ?? DEFAULT_FILTER;
  const setFilter = useRepoStore((s) => s.setFilter);
  const meta = useGraphMeta(repoId, filter);
  const refs = useRefs(repoId);
  const generation = meta.dataUpdatedAt;
  const { query, setQuery, matches, matchPos, step, jumpRef } = useGraphSearchState(
    repoId,
    generation,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const gutter = gutterWidth(meta.data?.laneCount ?? 1, COMPACT_METRICS, window.innerWidth);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <ShellAppBar
        repoId={repoId}
        actions={
          <>
            <IconButton
              aria-label="Search commits"
              aria-pressed={searchOpen}
              onClick={() => setSearchOpen((o) => !o)}
            >
              <Search />
            </IconButton>
            <IconButton
              aria-label="Filters"
              className={isFiltered(filter) ? "text-accent" : undefined}
              onClick={() => setFilterOpen(true)}
            >
              <Filter />
            </IconButton>
            <IconButton aria-label="Remote actions" onClick={() => setMoreOpen(true)}>
              <EllipsisVertical />
            </IconButton>
          </>
        }
      >
        {searchOpen ? (
          <div className="flex items-center gap-2 px-3 pb-2">
            <input
              type="search"
              aria-label="Search message, author, or oid"
              placeholder="Search message, author, or oid"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  step(e.shiftKey ? -1 : 1);
                }
              }}
              className="min-h-[var(--touch-target)] min-w-0 flex-1 rounded-md border border-border bg-bg-subtle px-3 text-base text-fg outline-none placeholder:text-fg-subtle"
            />
            {query.trim() !== "" && (
              <span className="font-mono text-xs text-fg-muted" data-testid="search-count">
                {matchPos + 1} / {matches.length}
              </span>
            )}
            <IconButton aria-label="Previous match" onClick={() => step(-1)}>
              <ArrowUp />
            </IconButton>
            <IconButton aria-label="Next match" onClick={() => step(1)}>
              <ArrowDown />
            </IconButton>
          </div>
        ) : null}
      </ShellAppBar>
      <WipRow repoId={repoId} gutter={gutter} compact onOpen={() => nav.setTab("changes")} />
      <PullToRefresh
        label="Fetching"
        onRefresh={() => fetchRemote(repoId, null)}
        getScrollElement={() => listRef.current}
        className="relative flex-1 overflow-hidden [&>div:last-child]:h-full"
      >
        <div className="relative h-full">
          {meta.isError ? (
            <p role="alert" className="p-4 text-sm text-danger">
              Could not load history: {meta.error.message}
            </p>
          ) : meta.data ? (
            <GraphList
              key={generation}
              repoId={repoId}
              filter={filter}
              meta={meta.data}
              generation={generation}
              listRef={listRef}
              jumpRef={jumpRef}
              variant="compact"
              onOpenCommit={(oid) => nav.push({ name: "commit", oid })}
            />
          ) : (
            <p className="p-4 text-sm text-fg-muted">Loading history…</p>
          )}
        </div>
      </PullToRefresh>
      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent snap="full">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription className="sr-only">Filter the commit history.</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 text-base">
            <FilterFields
              filter={filter}
              refs={refs.data}
              onApply={(f) => {
                setFilter(repoId, f);
                setFilterOpen(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
      <ActionSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title="Remote"
        items={[
          {
            id: "fetch",
            label: "Fetch",
            icon: <RefreshCw />,
            onSelect: () => void fetchRemote(repoId, null),
          },
          {
            id: "pull",
            label: "Pull",
            icon: <ArrowDown />,
            onSelect: () => void pullCurrent(client, repoId),
          },
          {
            id: "push",
            label: "Push",
            icon: <ArrowUp />,
            onSelect: () => void pushBranch(client, repoId),
          },
        ]}
      />
    </div>
  );
}
