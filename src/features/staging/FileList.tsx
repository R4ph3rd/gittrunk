import { Fragment, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Copy, FolderTree, List, Minus, Plus, Undo2 } from "lucide-react";
import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  IconButton,
  Separator,
  Tooltip,
  toast,
} from "@/design/components";
import type { FileChange, StatusSnapshot } from "@/ipc/bindings";
import { useStagePaths, useUnstagePaths } from "@/ipc/queries";
import { cn } from "@/lib/cn";
import { useOperationsStore } from "@/stores/operations";
import { useFileListMode } from "./fileListMode";
import {
  buildTree,
  filesUnder,
  flattenVisible,
  STATUS_LETTER,
  STATUS_TONE,
  type TreeItem,
} from "./fileTree";
import { TreeRow } from "./FileTree";
import { errorMessage, useDiscard } from "./ops";

export type Section = "conflicted" | "unstaged" | "staged";

export interface OpenFile {
  path: string;
  staged: boolean;
}

/** A focusable row: a file (list and tree mode) or a folder (tree mode). */
interface Item {
  key: string;
  section: Section;
  file: FileChange | null;
  tree: TreeItem | null;
}

const keyOf = (section: Section, path: string) => `${section}:${path}`;
const folderKey = (section: Section, path: string) => `folder:${section}:${path}`;

function splitPath(path: string): [string, string] {
  const i = path.lastIndexOf("/");
  return i < 0 ? ["", path] : [path.slice(0, i + 1), path.slice(i + 1)];
}

const SECTION_RULE: Record<Section, string> = {
  conflicted: "border-danger",
  unstaged: "border-unstaged",
  staged: "border-staged bg-staged-bg",
};

interface Props {
  repoId: string;
  status: StatusSnapshot;
  open: OpenFile | null;
  onOpen: (file: OpenFile) => void;
}

/** The list / tree pair of icon buttons shown in a section header. */
function ModeToggle() {
  const mode = useFileListMode((s) => s.mode);
  const setMode = useFileListMode((s) => s.setMode);
  const option = (value: "list" | "tree", label: string, icon: React.ReactNode) => (
    <Tooltip content={label}>
      <IconButton
        aria-label={label}
        aria-pressed={mode === value}
        size="xs"
        className={cn(
          "rounded-none",
          mode === value ? "bg-surface-raised text-fg" : "text-fg-muted",
        )}
        onClick={() => setMode(value)}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );
  return (
    <div className="inline-flex shrink-0 divide-x divide-border overflow-hidden rounded-md border border-border">
      {option("list", "Show as list", <List />)}
      {option("tree", "Show as tree", <FolderTree />)}
    </div>
  );
}

/** Conflicted, unstaged and staged files with multi-select, keyboard and context menu. */
export function FileList({ repoId, status, open, onOpen }: Props) {
  const stage = useStagePaths(repoId);
  const unstage = useUnstagePaths(repoId);
  const discard = useDiscard(repoId);
  const openConflict = useOperationsStore((s) => s.openConflict);
  const mode = useFileListMode((s) => s.mode);
  const collapsed = useFileListMode((s) => s.collapsed);
  const toggleCollapsed = useFileListMode((s) => s.toggleCollapsed);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);

  const items = useMemo<Item[]>(() => {
    const groups: [Section, FileChange[]][] = [
      ["conflicted", status.conflicted],
      ["unstaged", status.unstaged],
      ["staged", status.staged],
    ];
    return groups.flatMap(([section, files]): Item[] => {
      if (mode === "list") {
        return files.map((file) => ({
          key: keyOf(section, file.path),
          section,
          file,
          tree: null,
        }));
      }
      return flattenVisible(buildTree(files), (p) => collapsed.has(keyOf(section, p))).map(
        (tree) => ({
          key:
            tree.node.kind === "file"
              ? keyOf(section, tree.node.path)
              : folderKey(section, tree.node.path),
          section,
          file: tree.node.kind === "file" ? tree.node.file : null,
          tree,
        }),
      );
    });
  }, [status, mode, collapsed]);
  const fileItems = useMemo(() => items.filter((r) => r.file), [items]);
  const indexOf = (key: string | null) => items.findIndex((r) => r.key === key);
  const focusRow = items.find((r) => r.key === focusKey) ?? null;

  const fail = (what: string) => (e: unknown) =>
    toast.error(`Could not ${what}: ${errorMessage(e)}`);
  const stagePaths = (paths: string[]) => {
    if (paths.length) stage.mutateAsync(paths).catch(fail("stage"));
  };
  const unstagePaths = (paths: string[]) => {
    if (paths.length) unstage.mutateAsync(paths).catch(fail("unstage"));
  };

  /** Paths an action applies to: the selection when the row is part of it, a folder's files, else the row. */
  const pathsOf = (item: Item): string[] => {
    if (!item.file) return item.tree ? filesUnder(item.tree.node).map((f) => f.path) : [];
    if (!selected.has(item.key)) return [item.file.path];
    return fileItems
      .filter((r) => selected.has(r.key) && r.section === item.section)
      .map((r) => r.file?.path ?? "");
  };

  const toggleStage = (item: Item) => {
    const paths = pathsOf(item);
    if (item.section === "staged") unstagePaths(paths);
    else stagePaths(paths);
  };

  const requestDiscard = (item: Item) => {
    if (item.section === "staged") return;
    void discard.request({ kind: "paths", paths: pathsOf(item) });
  };

  const copyPaths = (item: Item) => {
    const text = (item.file ? pathsOf(item) : [item.tree?.node.path ?? ""]).join("\n");
    navigator.clipboard?.writeText(text).then(
      () => toast.success("Path copied"),
      () => toast.error("Could not copy to the clipboard"),
    );
  };

  const focusOn = (item: Item, mods: { shift: boolean; toggle: boolean }) => {
    setFocusKey(item.key);
    if (!item.file) {
      setSelected(new Set());
      return;
    }
    const fromIdx = fileItems.findIndex((r) => r.key === anchorKey);
    if (mods.shift && fromIdx >= 0) {
      const to = fileItems.findIndex((r) => r.key === item.key);
      const [a, b] = fromIdx <= to ? [fromIdx, to] : [to, fromIdx];
      const anchorSection = fileItems[fromIdx]?.section;
      setSelected(
        new Set(
          fileItems
            .slice(a, b + 1)
            .filter((r) => r.section === anchorSection)
            .map((r) => r.key),
        ),
      );
    } else if (mods.toggle) {
      const next = new Set(selected);
      if (next.has(item.key)) next.delete(item.key);
      else next.add(item.key);
      setSelected(next);
      setAnchorKey(item.key);
    } else {
      setSelected(new Set([item.key]));
      setAnchorKey(item.key);
    }
  };

  const setFolder = (item: Item, isCollapsed: boolean) => {
    if (item.tree?.node.kind === "folder")
      toggleCollapsed(keyOf(item.section, item.tree.node.path), isCollapsed);
  };

  /** Conflicted files open the 3-way resolver; everything else opens its diff. */
  const openRow = (item: Item) => {
    if (!item.file) return setFolder(item, item.tree?.expanded ?? false);
    if (item.section === "conflicted") openConflict(repoId, item.file.path);
    else onOpen({ path: item.file.path, staged: item.section === "staged" });
  };

  const onRowClick = (item: Item, e: MouseEvent) => {
    const mods = { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey };
    focusOn(item, mods);
    if (!mods.shift && !mods.toggle) openRow(item);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const at = indexOf(focusKey);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        items[
          Math.max(
            0,
            Math.min(items.length - 1, (at < 0 ? -1 : at) + (e.key === "ArrowDown" ? 1 : -1)),
          )
        ];
      if (next) focusOn(next, { shift: e.shiftKey, toggle: false });
    } else if (mode === "tree" && e.key === "ArrowRight" && focusRow?.tree) {
      e.preventDefault();
      if (focusRow.tree.node.kind !== "folder") return;
      if (!focusRow.tree.expanded) setFolder(focusRow, false);
      else {
        const child = items[at + 1];
        if (child && child.tree?.parentPath === focusRow.tree.node.path) focusOn(child, noMods);
      }
    } else if (mode === "tree" && e.key === "ArrowLeft" && focusRow?.tree) {
      e.preventDefault();
      if (focusRow.tree.node.kind === "folder" && focusRow.tree.expanded) setFolder(focusRow, true);
      else {
        const parent = items.find(
          (r) =>
            r.section === focusRow.section &&
            r.tree?.node.kind === "folder" &&
            r.tree.node.path === focusRow.tree?.parentPath,
        );
        if (parent) focusOn(parent, noMods);
      }
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
      setSelected(
        new Set(fileItems.filter((r) => r.section === focusRow.section).map((r) => r.key)),
      );
    }
  };

  const menu = (item: Item, trigger: React.ReactNode) => (
    <ContextMenu key={item.key}>
      <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
      <ContextMenuContent>
        {item.section !== "staged" && (
          <ContextMenuItem icon={<Plus />} shortcut="Space" onSelect={() => toggleStage(item)}>
            Stage
          </ContextMenuItem>
        )}
        {item.section === "staged" && (
          <ContextMenuItem icon={<Minus />} shortcut="Space" onSelect={() => toggleStage(item)}>
            Unstage
          </ContextMenuItem>
        )}
        {item.section !== "staged" && (
          <ContextMenuItem
            icon={<Undo2 />}
            shortcut="Del"
            destructive
            onSelect={() => requestDiscard(item)}
          >
            Discard changes
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Copy />} onSelect={() => copyPaths(item)}>
          Copy path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  const onContext = (item: Item) => () => {
    if (!selected.has(item.key)) focusOn(item, noMods);
    setFocusKey(item.key);
  };

  const renderListRow = (row: Item) => {
    const file = row.file;
    if (!file) return null;
    const [dir, base] = splitPath(file.path);
    const isSelected = selected.has(row.key);
    const isOpen = open?.path === file.path && open.staged === (row.section === "staged");
    const staging =
      row.section === "staged"
        ? "Unstage"
        : row.section === "conflicted"
          ? "Mark resolved"
          : "Stage";
    return menu(
      row,
      <div
        role="option"
        id={`staging-row-${indexOf(row.key)}`}
        aria-selected={isSelected}
        data-section={row.section}
        data-path={file.path}
        onClick={(e) => onRowClick(row, e)}
        onContextMenu={onContext(row)}
        className={cn(
          "group flex h-6 items-center gap-2 px-3 text-sm",
          isSelected ? "bg-accent-muted" : "hover:bg-surface-hover",
          isOpen && "font-medium",
          focusKey === row.key &&
            "outline outline-1 -outline-offset-1 outline-[color:var(--focus-ring)]",
        )}
      >
        <span
          className={cn("w-4 shrink-0 text-center font-mono text-xs", STATUS_TONE[file.status])}
          title={file.status}
        >
          {STATUS_LETTER[file.status]}
        </span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        >
          <span className="text-fg-subtle">{dir}</span>
          {base}
        </span>
        <IconButton
          aria-label={`${staging} ${file.path}`}
          tabIndex={-1}
          className="size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            if (row.section === "staged") unstagePaths([file.path]);
            else stagePaths([file.path]);
          }}
        >
          {row.section === "staged" ? <Minus /> : <Plus />}
        </IconButton>
      </div>,
    );
  };

  const renderTreeRow = (row: Item) => {
    if (!row.tree) return null;
    const file = row.file;
    return menu(
      row,
      <TreeRow
        item={row.tree}
        id={`staging-row-${indexOf(row.key)}`}
        selected={selected.has(row.key)}
        focused={focusKey === row.key}
        isOpen={!!file && open?.path === file.path && open.staged === (row.section === "staged")}
        staged={row.section === "staged"}
        onClick={(e) => onRowClick(row, e)}
        onContextMenu={onContext(row)}
        onAction={() => {
          const paths = file ? [file.path] : pathsOf(row);
          if (row.section === "staged") unstagePaths(paths);
          else stagePaths(paths);
        }}
        onToggle={() => setFolder(row, row.tree?.expanded ?? false)}
      />,
    );
  };

  const visibleSections = (
    [
      ["conflicted", "Conflicted", status.conflicted],
      ["unstaged", "Unstaged", status.unstaged],
      ["staged", "Staged", status.staged],
    ] as const
  ).filter(([, , files]) => files.length > 0);
  // The mode toggle lives in the Unstaged header, or the first block when there is none.
  const toggleIn: Section | undefined = status.unstaged.length
    ? "unstaged"
    : visibleSections[0]?.[0];

  const actions: Partial<Record<Section, { label: string; run: () => void }>> = {
    unstaged: { label: "Stage all", run: () => stagePaths(status.unstaged.map((f) => f.path)) },
    staged: { label: "Unstage all", run: () => unstagePaths(status.staged.map((f) => f.path)) },
  };

  return (
    <div
      role={mode === "tree" ? "tree" : "listbox"}
      aria-label="Changed files"
      aria-multiselectable="true"
      aria-activedescendant={focusKey ? `staging-row-${indexOf(focusKey)}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !focusKey && items[0]) setFocusKey(items[0].key);
      }}
      className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[color:var(--focus-ring)]"
    >
      {visibleSections.map(([id, title, files], n) => {
        const action = actions[id];
        return (
          <Fragment key={id}>
            {n > 0 && <Separator />}
            <section
              aria-label={title}
              data-testid={`section-${id}`}
              role={mode === "tree" ? "group" : undefined}
              className={cn("border-l-2", SECTION_RULE[id])}
            >
              <header className="sticky top-0 z-10 flex h-7 items-center gap-2 bg-panel-header px-3 text-xs font-medium uppercase tracking-wide text-fg-subtle">
                {title}
                {id === "conflicted" && <Badge variant="danger">conflict</Badge>}
                <Badge variant="neutral" className="font-mono normal-case">
                  {files.length}
                </Badge>
                <span className="ml-auto flex items-center gap-2 normal-case">
                  {toggleIn === id && <ModeToggle />}
                  {action && (
                    <Button size="sm" variant="ghost" onClick={action.run}>
                      {action.label}
                    </Button>
                  )}
                </span>
              </header>
              {items
                .filter((r) => r.section === id)
                .map(mode === "tree" ? renderTreeRow : renderListRow)}
            </section>
          </Fragment>
        );
      })}
      {discard.dialog}
    </div>
  );
}

const noMods = { shift: false, toggle: false };
