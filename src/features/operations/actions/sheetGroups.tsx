import type { ActionSheetItem } from "@/design/components";
import type { ActionEntry } from "./types";

/**
 * The same entries as `ActionSheet` groups: separators split groups, section labels are dropped
 * (item labels already carry their context).
 */
export function entriesToSheetGroups(entries: ActionEntry[]): ActionSheetItem[][] {
  const groups: ActionSheetItem[][] = [[]];
  for (const e of entries) {
    if (e.kind === "separator") {
      if (groups[groups.length - 1]?.length) groups.push([]);
    } else if (e.kind === "item") {
      const Icon = e.icon;
      groups[groups.length - 1]?.push({
        id: e.id,
        label: e.label,
        icon: Icon ? <Icon /> : undefined,
        destructive: e.destructive,
        disabled: e.disabled,
        onSelect: () => e.run(),
      });
    }
  }
  return groups.filter((g) => g.length > 0);
}
