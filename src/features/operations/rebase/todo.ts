import type { RebaseAction, RebaseTodoItem } from "@/ipc/bindings";

/** One row of the editor. `message === null` means the user has not edited it. */
export interface EditorItem {
  oid: string;
  summary: string;
  action: RebaseAction;
  message: string | null;
}

export const ACTIONS: RebaseAction[] = ["pick", "reword", "edit", "squash", "fixup", "drop"];

/** Single-key shortcuts on a focused row. */
export const ACTION_KEYS: Record<string, RebaseAction> = {
  p: "pick",
  r: "reword",
  e: "edit",
  s: "squash",
  f: "fixup",
  d: "drop",
};

export function toEditorItems(todo: RebaseTodoItem[]): EditorItem[] {
  return todo.map((t) => ({
    oid: t.oid,
    summary: t.summary,
    action: t.action,
    message: t.message,
  }));
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

const isFold = (a: RebaseAction) => a === "squash" || a === "fixup";
const ownMessage = (item: EditorItem, full: Record<string, string>) =>
  item.message ?? full[item.oid] ?? item.summary;

/**
 * The message the backend receives for `reword` and `squash` rows (null for others).
 * Reword: the edited text or the commit's full message. Squash: the edited text or the combined
 * message of its group (the kept commit it folds into plus every squash up to this row; fixups
 * add nothing).
 */
export function effectiveMessage(
  items: EditorItem[],
  index: number,
  full: Record<string, string>,
): string | null {
  const item = items[index];
  if (!item) return null;
  if (item.action === "reword") return ownMessage(item, full);
  if (item.action !== "squash") return null;
  if (item.message !== null) return item.message;
  let root = -1;
  for (let k = index - 1; k >= 0; k--) {
    const a = items[k]!.action;
    if (a === "drop") continue;
    if (!isFold(a)) {
      root = k;
      break;
    }
  }
  if (root < 0) return ownMessage(item, full);
  const parts = [effectiveRootMessage(items[root]!, full)];
  for (let k = root + 1; k <= index; k++) {
    if (items[k]!.action === "squash") parts.push(ownMessage(items[k]!, full));
  }
  return parts.join("\n\n");
}

const effectiveRootMessage = (item: EditorItem, full: Record<string, string>) =>
  item.action === "reword" ? ownMessage(item, full) : (full[item.oid] ?? item.summary);

/** Mirrors the backend checks so mistakes show before a round trip. */
export function validateTodo(items: EditorItem[], full: Record<string, string>): string[] {
  const errors: string[] = [];
  const kept = items.filter((i) => i.action !== "drop");
  if (kept.length === 0) {
    errors.push("Keep at least one commit; dropping everything would empty the branch.");
  } else if (isFold(kept[0]!.action)) {
    errors.push("The first kept commit cannot be squash or fixup: there is nothing to fold into.");
  }
  items.forEach((item, i) => {
    const m = effectiveMessage(items, i, full);
    if (m !== null && m.trim() === "") {
      errors.push(`The message for "${item.summary}" is empty.`);
    }
  });
  return errors;
}

/** The exact todo sent to `rebaseInteractive`, in list order. */
export function buildTodo(items: EditorItem[], full: Record<string, string>): RebaseTodoItem[] {
  return items.map((item, i) => ({
    action: item.action,
    oid: item.oid,
    summary: item.summary,
    message: effectiveMessage(items, i, full),
  }));
}
