import type { MouseEvent } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Minus, Plus } from "lucide-react";
import { IconButton } from "@/design/components";
import { cn } from "@/lib/cn";
import { rowClass, STATUS_LETTER, STATUS_TONE, type TreeItem } from "./fileTree";

interface Props {
  item: TreeItem;
  id: string;
  selected: boolean;
  focused: boolean;
  isOpen: boolean;
  /** Section decides the hover button: staged rows unstage, the others stage. */
  staged: boolean;
  onClick: (e: MouseEvent) => void;
  onContextMenu: () => void;
  onAction: () => void;
  /** Collapse or expand (folders only). */
  onToggle: () => void;
}

/** One visible row of a folder tree: a folder with chevron and count, or a file. */
export function TreeRow({
  item,
  id,
  selected,
  focused,
  isOpen,
  staged,
  onClick,
  onContextMenu,
  onAction,
  onToggle,
}: Props) {
  const { node, level, expanded } = item;
  const indent = { paddingLeft: `${(level - 1) * 12 + 8}px` };
  const actionLabel =
    (staged ? "Unstage " : "Stage ") + (node.kind === "folder" ? `${node.path}/` : node.path);
  const action = (
    <IconButton
      aria-label={actionLabel}
      tabIndex={-1}
      className="size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      onClick={(e) => {
        e.stopPropagation();
        onAction();
      }}
    >
      {staged ? <Minus /> : <Plus />}
    </IconButton>
  );

  if (node.kind === "folder") {
    return (
      <div
        role="treeitem"
        id={id}
        aria-level={level}
        aria-expanded={expanded}
        aria-label={node.name}
        data-kind="folder"
        data-path={node.path}
        onClick={onClick}
        onContextMenu={onContextMenu}
        style={indent}
        className={rowClass(false, focused)}
      >
        <span
          className="flex shrink-0 text-fg-muted"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
        {expanded ? (
          <FolderOpen className="size-3.5 shrink-0 text-fg-muted" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-fg-muted" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={node.path}>
          {node.name}
        </span>
        <span className="font-mono text-xs text-fg-subtle">{node.count}</span>
        {action}
      </div>
    );
  }

  const { file } = node;
  return (
    <div
      role="treeitem"
      id={id}
      aria-level={level}
      aria-selected={selected}
      aria-label={file.path}
      data-kind="file"
      data-path={file.path}
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{ paddingLeft: `${(level - 1) * 12 + 8 + 18}px` }}
      className={cn(rowClass(selected, focused), isOpen && "font-medium")}
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
        {node.name}
      </span>
      {action}
    </div>
  );
}
