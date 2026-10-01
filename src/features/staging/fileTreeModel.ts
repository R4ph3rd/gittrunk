import type { ChangeStatus, FileChange } from "@/ipc/bindings";
import { cn } from "@/lib/cn";

export const STATUS_LETTER: Record<ChangeStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typeChange: "T",
  untracked: "U",
  conflicted: "!",
};

export const STATUS_TONE: Record<ChangeStatus, string> = {
  added: "text-success",
  untracked: "text-success",
  modified: "text-warning",
  typeChange: "text-warning",
  deleted: "text-danger",
  conflicted: "text-danger",
  renamed: "text-accent",
  copied: "text-accent",
};

/** Shared row chrome so list and tree rows focus and select the same way. */
export const rowClass = (selected: boolean, focused: boolean) =>
  cn(
    "group flex h-6 items-center gap-2 pr-3 text-sm",
    selected ? "bg-accent-muted" : "hover:bg-surface-hover",
    focused && "outline outline-1 -outline-offset-1 outline-[color:var(--focus-ring)]",
  );

export interface FolderNode {
  kind: "folder";
  /** Display name; compacted chains read `src/features/staging`. */
  name: string;
  /** Full path of the (deepest) folder in the chain, without trailing slash. */
  path: string;
  children: TreeNode[];
  /** Number of files below this folder. */
  count: number;
}

export interface FileNode {
  kind: "file";
  name: string;
  path: string;
  file: FileChange;
}

export type TreeNode = FolderNode | FileNode;

interface Draft {
  folders: Map<string, Draft>;
  files: FileChange[];
}

const cmp = (a: string, b: string) =>
  a.toLowerCase().localeCompare(b.toLowerCase()) || (a < b ? -1 : a > b ? 1 : 0);

/** Sorted tree (folders first, then files, case-insensitive) with single-child chains compacted. */
export function buildTree(files: readonly FileChange[]): TreeNode[] {
  const root: Draft = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let at = root;
    for (const dir of parts.slice(0, -1)) {
      let next = at.folders.get(dir);
      if (!next) {
        next = { folders: new Map(), files: [] };
        at.folders.set(dir, next);
      }
      at = next;
    }
    at.files.push(file);
  }

  const countOf = (d: Draft): number =>
    d.files.length + [...d.folders.values()].reduce((n, f) => n + countOf(f), 0);

  const build = (d: Draft, prefix: string): TreeNode[] => {
    const folders: FolderNode[] = [...d.folders.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([name, child]) => {
        let label = name;
        let path = prefix + name;
        let cur = child;
        // Compact chains of folders that hold exactly one sub-folder and no files.
        while (cur.files.length === 0 && cur.folders.size === 1) {
          const [entry] = [...cur.folders.entries()];
          if (!entry) break;
          label += `/${entry[0]}`;
          path += `/${entry[0]}`;
          cur = entry[1];
        }
        return {
          kind: "folder" as const,
          name: label,
          path,
          children: build(cur, `${path}/`),
          count: countOf(cur),
        };
      });
    const leaves: FileNode[] = d.files
      .map((file) => ({
        kind: "file" as const,
        name: file.path.slice(file.path.lastIndexOf("/") + 1),
        path: file.path,
        file,
      }))
      .sort((a, b) => cmp(a.name, b.name));
    return [...folders, ...leaves];
  };

  return build(root, "");
}

/** Every file below a node (the node itself when it is a file). */
export function filesUnder(node: TreeNode): FileChange[] {
  if (node.kind === "file") return [node.file];
  return node.children.flatMap(filesUnder);
}

export interface TreeItem {
  node: TreeNode;
  /** 1-based, as in aria-level. */
  level: number;
  parentPath: string | null;
  expanded: boolean;
}

/** Depth-first list of the items visible given a collapsed predicate on folder paths. */
export function flattenVisible(
  nodes: readonly TreeNode[],
  isCollapsed: (folderPath: string) => boolean,
  level = 1,
  parentPath: string | null = null,
): TreeItem[] {
  const out: TreeItem[] = [];
  for (const node of nodes) {
    const expanded = node.kind === "folder" && !isCollapsed(node.path);
    out.push({ node, level, parentPath, expanded });
    if (node.kind === "folder" && expanded)
      out.push(...flattenVisible(node.children, isCollapsed, level + 1, node.path));
  }
  return out;
}
