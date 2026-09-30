import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Filter } from "lucide-react";
import type { CommitOrder, GraphFilter, RefsSnapshot } from "@/ipc/bindings";
import { cn } from "@/lib/cn";
import { isFiltered } from "./filters";

interface Props {
  filter: GraphFilter;
  refs: RefsSnapshot | undefined;
  onApply: (filter: GraphFilter) => void;
}

const field = "h-7 w-full rounded-sm border border-border bg-bg-subtle px-2 text-sm text-fg";

export function FilterPopover({ filter, refs, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filter);

  const branchNames = [...(refs?.local ?? []), ...(refs?.remote ?? [])].map((b) => b.fullName);
  const selected = new Set(draft.refs ?? []);
  const toggleRef = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setDraft({ ...draft, refs: [...next] });
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(filter);
        setOpen(o);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Filters"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-sm border border-border px-2 text-sm hover:bg-surface-hover",
            isFiltered(filter) ? "text-accent" : "text-fg-muted",
          )}
        >
          <Filter className="size-3.5" aria-hidden />
          Filters
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 flex w-72 flex-col gap-3 rounded-md border border-border-strong bg-surface-raised p-3 text-sm shadow-md"
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-xs text-fg-muted">Refs</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="refs-mode"
                checked={draft.refs === null}
                onChange={() => setDraft({ ...draft, refs: null })}
              />
              All refs
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="refs-mode"
                checked={draft.refs !== null}
                onChange={() => setDraft({ ...draft, refs: draft.refs ?? [] })}
              />
              Selected refs
            </label>
            {draft.refs !== null && (
              <div className="ml-5 max-h-32 overflow-auto">
                {branchNames.map((name) => (
                  <label key={name} className="flex items-center gap-2 font-mono text-xs">
                    <input
                      type="checkbox"
                      checked={selected.has(name)}
                      onChange={() => toggleRef(name)}
                    />
                    {name.replace(/^refs\/(heads|remotes)\//, "")}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.firstParent}
              onChange={(e) => setDraft({ ...draft, firstParent: e.target.checked })}
            />
            First parent only
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">Order</span>
            <select
              className={field}
              value={draft.order}
              onChange={(e) => setDraft({ ...draft, order: e.target.value as CommitOrder })}
            >
              <option value="topo">Topological</option>
              <option value="date">Date</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">Author</span>
            <input
              className={field}
              value={draft.author ?? ""}
              onChange={(e) => setDraft({ ...draft, author: e.target.value || null })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">Path</span>
            <input
              className={cn(field, "font-mono")}
              value={draft.path ?? ""}
              onChange={(e) => setDraft({ ...draft, path: e.target.value || null })}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="h-7 rounded-sm px-2 text-fg-muted hover:bg-surface-hover"
              onClick={() =>
                setDraft({
                  ...draft,
                  refs: null,
                  firstParent: false,
                  order: "topo",
                  author: null,
                  path: null,
                })
              }
            >
              Reset
            </button>
            <button
              type="button"
              className="h-7 rounded-sm bg-accent px-3 font-medium text-accent-fg"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
