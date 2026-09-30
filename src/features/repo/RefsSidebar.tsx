import { useState, type ComponentProps, type ReactNode } from "react";
import { ArrowDownToLine, ChevronDown, ChevronRight, Trash2, Undo2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/design/components";
import { stashLabel, useStashActions } from "@/features/stash/useStashActions";
import { useRefs } from "@/ipc/queries";
import { cn } from "@/lib/cn";
import { useRepoStore } from "@/stores/repo";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1 px-2 text-xs font-medium uppercase tracking-wide text-fg-subtle hover:text-fg-muted"
      >
        <Chevron className="size-3" aria-hidden />
        {title}
        <span className="ml-auto font-mono">{count}</span>
      </button>
      {open && <ul>{children}</ul>}
    </section>
  );
}

function Item({
  label,
  active,
  hint,
  onClick,
  ...rest
}: {
  label: string;
  active?: boolean;
  hint?: string;
  onClick?: () => void;
} & Omit<ComponentProps<"button">, "children" | "className" | "type">) {
  return (
    <li>
      <button
        {...rest}
        type="button"
        onClick={onClick}
        className={cn(
          "flex h-6 w-full items-center gap-2 truncate pl-6 pr-2 text-left text-sm hover:bg-surface-hover",
          active ? "font-semibold text-accent" : "text-fg",
        )}
      >
        <span className="truncate">{label}</span>
        {hint && <span className="ml-auto shrink-0 font-mono text-xs text-fg-subtle">{hint}</span>}
      </button>
    </li>
  );
}

export function RefsSidebar({ repoId }: { repoId: string }) {
  const refs = useRefs(repoId);
  const select = useRepoStore((s) => s.selectCommit);
  const stash = useStashActions(repoId);
  const data = refs.data;

  return (
    <nav aria-label="References" className="h-full overflow-y-auto bg-surface py-1">
      {refs.isError && <p className="p-3 text-sm text-danger">{refs.error.message}</p>}
      {data && (
        <>
          <Section title="Branches" count={data.local.length}>
            {data.local.map((b) => (
              <Item
                key={b.fullName}
                label={b.name}
                active={b.isHead}
                hint={b.ahead || b.behind ? `+${b.ahead} -${b.behind}` : undefined}
                onClick={() => select(repoId, b.oid)}
              />
            ))}
          </Section>
          <Section title="Remotes" count={data.remote.length}>
            {data.remote.map((b) => (
              <Item key={b.fullName} label={b.name} onClick={() => select(repoId, b.oid)} />
            ))}
          </Section>
          <Section title="Tags" count={data.tags.length}>
            {data.tags.map((t) => (
              <Item key={t.name} label={t.name} onClick={() => select(repoId, t.oid)} />
            ))}
          </Section>
          <Section title="Stashes" count={data.stashes.length}>
            {data.stashes.map((s) => (
              <ContextMenu key={s.index}>
                <ContextMenuTrigger asChild>
                  <Item label={stashLabel(s)} onClick={() => select(repoId, s.oid)} />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem icon={<Undo2 />} onSelect={() => void stash.apply(s, false)}>
                    Apply
                  </ContextMenuItem>
                  <ContextMenuItem
                    icon={<ArrowDownToLine />}
                    onSelect={() => void stash.apply(s, true)}
                  >
                    Pop
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    icon={<Trash2 />}
                    destructive
                    onSelect={() => void stash.drop(s)}
                  >
                    Drop
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </Section>
        </>
      )}
      {stash.dialog}
    </nav>
  );
}
