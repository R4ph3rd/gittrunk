import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Copy, Minus, Plus, Undo2 } from "lucide-react";
import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  IconButton,
  toast,
} from "@/design/components";
import type { ChangeStatus, FileChange, StatusSnapshot } from "@/ipc/bindings";
import { useStagePaths, useUnstagePaths } from "@/ipc/queries";
import { cn } from "@/lib/cn";
import { useOperationsStore } from "@/stores/operations";
import { errorMessage, useDiscard } from "./ops";

export type Section = "conflicted" | "unstaged" | "staged";

export interface OpenFile {
  path: string;
  staged: boolean;
}

interface Row {
  key: string;
  section: Section;
  file: FileChange;
}

const keyOf = (section: Section, path: string) => `${section}:${path}`;

const LETTER: Record<ChangeStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typeChange: "T",
  untracked: "U",
  conflicted: "!",
};

const LETTER_TONE: Record<ChangeStatus, string> = {
  added: "text-success",
  untracked: "text-success",
  modified: "text-warning",
  typeChange: "text-warning",
  deleted: "text-danger",
  conflicted: "text-danger",
  renamed: "text-accent",
  copied: "text-accent",
};

function splitPath(path: string): [string, string] {
  const i = path.lastIndexOf("/");
  return i < 0 ? ["", path] : [path.slice(0, i + 1), path.slice(i + 1)];
}

interface Props {
  repoId: string;
  status: StatusSnapshot;
  open: OpenFile | null;
  onOpen: (file: OpenFile) => void;
}

/** Conflicted, unstaged and staged files with multi-select, keyboard and context menu. */
export function FileList({ repoId, status, open, onOpen }: Props) {
  const stage = useStagePaths(repoId);
  const unstage = useUnstagePaths(repoId);
  const discard = useDiscard(repoId);
  const openConflict = useOperationsStore((s) => s.openConflict);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);

  const rows = useMemo<Row[]>(
    () => [
      ...status.conflicted.map((file) => ({
        key: keyOf("conflicted", file.path),
        section: "conflicted" as const,
        file,
      })),
      ...status.unstaged.map((file) => ({
        key: keyOf("unstaged", file.path),
        section: "unstaged" as const,
        file,
      })),
      ...status.staged.map((file) => ({
        key: keyOf("staged", file.path),
        section: "staged" as const,
        file,
      })),
    ],
    [status],
  );
  const indexOf = (key: string | null) => rows.findIndex((r) => r.key === key);
  const focusRow = rows.find((r) => r.key === focusKey) ?? null;

  const fail = (what: string) => (e: unknown) =>
    toast.error(`Could not ${what}: ${errorMessage(e)}`);
  const stagePaths = (paths: string[]) => {
    if (paths.length) stage.mutateAsync(paths).catch(fail("stage"));
  };
  const unstagePaths = (paths: string[]) => {
    if (paths.length) unstage.mutateAsync(paths).catch(fail("unstage"));
  };

  /** Rows an action applies to: the selection when the row is part of it, else just the row. */
  const targets = (row: Row): Row[] =>
    selected.has(row.key)
      ? rows.filter((r) => selected.has(r.key) && r.section === row.section)
      : [row];

  const toggleStage = (row: Row) => {
    const paths = targets(row).map((r) => r.file.path);
    if (row.section === "staged") unstagePaths(paths);
    else stagePaths(paths);
  };

  const requestDiscard = (row: Row) => {
    if (row.section === "staged") return;
    void discard.request({ kind: "paths", paths: targets(row).map((r) => r.file.path) });
  };

  const copyPaths = (row: Row) => {
    const text = targets(row)
      .map((r) => r.file.path)
      .join("\n");
    navigator.clipboard?.writeText(text).then(
      () => toast.success("Path copied"),
      () => toast.error("Could not copy to the clipboard"),
    );
  };

  const focusOn = (row: Row, mods: { shift: boolean; toggle: boolean }) => {
    setFocusKey(row.key);
    if (mods.shift && anchorKey && indexOf(anchorKey) >= 0) {
      const from = indexOf(anchorKey);
      const to = indexOf(row.key);
      const [a, b] = from <= to ? [from, to] : [to, from];
      const anchorSection = rows[from]?.section;
      setSelected(
        new Set(
          rows
            .slice(a, b + 1)
            .filter((r) => r.section === anchorSection)
            .map((r) => r.key),
        ),
      );
    } else if (mods.toggle) {
      const next = new Set(selected);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      setSelected(next);
      setAnchorKey(row.key);
    } else {
      setSelected(new Set([row.key]));
      setAnchorKey(row.key);
    }
  };

  /** Conflicted files open the 3-way resolver; everything else opens its diff. */
  const openRow = (row: Row) => {
    if (row.section === "conflicted") openConflict(repoId, row.file.path);
    else onOpen({ path: row.file.path, staged: row.section === "staged" });
  };

  const onRowClick = (row: Row, e: MouseEvent) => {
    const mods = { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey };
    focusOn(row, mods);
    if (!mods.shift && !mods.toggle) openRow(row);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = indexOf(focusKey);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        rows[
          Math.max(
            0,
            Math.min(rows.length - 1, (at < 0 ? -1 : at) + (e.key === "ArrowDown" ? 1 : -1)),
          )
        ];
      if (next) focusOn(next, { shift: e.shiftKey, toggle: false });
    } else if (e.key === " " && focusRow) {
      e.preventDefault();
      toggleStage(focusRow);
    } else if (e.key === "Enter" && focusRow) {
      e.preventDefault();
      openRow(focusRow);
    } else if (e.key === "Delete" && focusRow) {
      e.preventDefault();
      requestDiscard(focusRow);
    } else if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey) && focusRow) {
      e.preventDefault();
      setSelected(new Set(rows.filter((r) => r.section === focusRow.section).map((r) => r.key)));
    }
  };

  const renderRow = (row: Row) => {
    const [dir, base] = splitPath(row.file.path);
    const isSelected = selected.has(row.key);
    const isOpen = open?.path === row.file.path && open.staged === (row.section === "staged");
    const staging =
      row.section === "staged"
        ? "Unstage"
        : row.section === "conflicted"
          ? "Mark resolved"
          : "Stage";
    return (
      <ContextMenu key={row.key}>
        <ContextMenuTrigger asChild>
          <div
            role="option"
            id={`staging-row-${indexOf(row.key)}`}
            aria-selected={isSelected}
            data-section={row.section}
            data-path={row.file.path}
            onClick={(e) => onRowClick(row, e)}
            onContextMenu={() => {
              if (!selected.has(row.key)) focusOn(row, { shift: false, toggle: false });
              setFocusKey(row.key);
            }}
            className={cn(
              "group flex h-6 items-center gap-2 px-3 text-sm",
              isSelected ? "bg-accent-muted" : "hover:bg-surface-hover",
              isOpen && "font-medium",
              focusKey === row.key &&
                "outline outline-1 -outline-offset-1 outline-[color:var(--focus-ring)]",
            )}
          >
            <span
              className={cn(
                "w-4 shrink-0 text-center font-mono text-xs",
                LETTER_TONE[row.file.status],
              )}
              title={row.file.status}
            >
              {LETTER[row.file.status]}
            </span>
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs"
              title={row.file.oldPath ? `${row.file.oldPath} → ${row.file.path}` : row.file.path}
            >
              <span className="text-fg-subtle">{dir}</span>
              {base}
            </span>
            <IconButton
              aria-label={`${staging} ${row.file.path}`}
              tabIndex={-1}
              className="size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                if (row.section === "staged") unstagePaths([row.file.path]);
                else stagePaths([row.file.path]);
              }}
            >
              {row.section === "staged" ? <Minus /> : <Plus />}
            </IconButton>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {row.section !== "staged" && (
            <ContextMenuItem icon={<Plus />} shortcut="Space" onSelect={() => toggleStage(row)}>
              Stage
            </ContextMenuItem>
          )}
          {row.section === "staged" && (
            <ContextMenuItem icon={<Minus />} shortcut="Space" onSelect={() => toggleStage(row)}>
              Unstage
            </ContextMenuItem>
          )}
          {row.section !== "staged" && (
            <ContextMenuItem
              icon={<Undo2 />}
              shortcut="Del"
              destructive
              onSelect={() => requestDiscard(row)}
            >
              Discard changes
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem icon={<Copy />} onSelect={() => copyPaths(row)}>
            Copy path
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const section = (
    id: Section,
    title: string,
    files: FileChange[],
    action?: { label: string; run: () => void },
  ) =>
    files.length > 0 && (
      <section aria-label={title} data-testid={`section-${id}`}>
        <header className="flex h-7 items-center gap-2 px-3 text-xs font-medium uppercase tracking-wide text-fg-subtle">
          {title}
          {id === "conflicted" && <Badge variant="danger">conflict</Badge>}
          <span className="font-mono">{files.length}</span>
          {action && (
            <Button size="sm" variant="ghost" className="ml-auto normal-case" onClick={action.run}>
              {action.label}
            </Button>
          )}
        </header>
        {rows.filter((r) => r.section === id).map(renderRow)}
      </section>
    );

  return (
    <div
      role="listbox"
      aria-label="Changed files"
      aria-multiselectable="true"
      aria-activedescendant={focusKey ? `staging-row-${indexOf(focusKey)}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (!focusKey && rows[0]) setFocusKey(rows[0].key);
      }}
      className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
    >
      {section("conflicted", "Conflicted", status.conflicted)}
      {section("unstaged", "Unstaged", status.unstaged, {
        label: "Stage all",
        run: () => stagePaths(status.unstaged.map((f) => f.path)),
      })}
      {section("staged", "Staged", status.staged, {
        label: "Unstage all",
        run: () => unstagePaths(status.staged.map((f) => f.path)),
      })}
      {discard.dialog}
    </div>
  );
}
