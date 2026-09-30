import type { Ref } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import type { GraphFilter, RefsSnapshot } from "@/ipc/bindings";
import { FilterPopover } from "./FilterPopover";

interface Props {
  query: string;
  onQuery: (q: string) => void;
  /** 1-based current match, 0 when none is active. */
  current: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onEscape: () => void;
  inputRef: Ref<HTMLInputElement>;
  filter: GraphFilter;
  refs: RefsSnapshot | undefined;
  onFilter: (f: GraphFilter) => void;
}

export function GraphToolbar(props: Props) {
  const { inputRef, ...p } = props;
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
      <div className="flex h-7 flex-1 items-center gap-2 rounded-sm border border-border bg-bg-subtle px-2">
        <Search className="size-3.5 text-fg-subtle" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          aria-label="Search commits"
          placeholder="Search message, author, or oid  ( / )"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) p.onPrev();
              else p.onNext();
            } else if (e.key === "Escape") {
              p.onEscape();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
        {p.query.trim() !== "" && (
          <span className="font-mono text-xs text-fg-muted" data-testid="search-count">
            {p.current} / {p.total}
          </span>
        )}
        <button
          type="button"
          aria-label="Previous match"
          onClick={p.onPrev}
          className="text-fg-muted hover:text-fg"
        >
          <ChevronUp className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Next match"
          onClick={p.onNext}
          className="text-fg-muted hover:text-fg"
        >
          <ChevronDown className="size-3.5" />
        </button>
      </div>
      <FilterPopover filter={p.filter} refs={p.refs} onApply={p.onFilter} />
    </div>
  );
}
