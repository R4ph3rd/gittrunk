import { useState } from "react";
import { Minus, Plus, Undo2 } from "lucide-react";
import { ActionSheet, Checkbox, ListRow, SwipeRow } from "@/design/components";
import { useLongPress } from "@/design/hooks";
import type { ChangeStatus, FileChange } from "@/ipc/bindings";
import { cn } from "@/lib/cn";

export type FileSection = "conflicted" | "unstaged" | "staged";

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

const TONE: Record<ChangeStatus, string> = {
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
  section: FileSection;
  file: FileChange;
  onOpen: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
}

/**
 * One changed file: 44px checkbox (stages or unstages), tappable row (opens the diff), swipe
 * actions and a long-press sheet with the same actions.
 */
export function FileRow({ section, file, onOpen, onStage, onUnstage, onDiscard }: Props) {
  const [menu, setMenu] = useState(false);
  const longPress = useLongPress(() => setMenu(true), { disabled: section === "conflicted" });
  const [dir, base] = splitPath(file.path);
  const staged = section === "staged";
  const conflicted = section === "conflicted";

  const row = (
    <div className="flex items-center bg-surface" data-path={file.path} data-section={section}>
      {conflicted ? null : (
        <Checkbox
          aria-label={`${staged ? "Unstage" : "Stage"} ${file.path}`}
          checked={staged}
          className="mx-1"
          onCheckedChange={(on) => (on ? onStage() : onUnstage())}
        />
      )}
      <ListRow
        {...longPress}
        title={base}
        subtitle={dir || undefined}
        leading={
          <span
            className={cn("w-4 text-center font-mono text-sm", TONE[file.status])}
            title={file.status}
          >
            {LETTER[file.status]}
          </span>
        }
        chevron
        onClick={onOpen}
        aria-label={`Open ${file.path}`}
        className="flex-1"
      />
    </div>
  );

  if (conflicted) return row;

  return (
    <>
      <SwipeRow
        {...(staged
          ? {
              rightAction: {
                label: "Unstage",
                icon: <Minus />,
                tone: "neutral",
                onTrigger: onUnstage,
              },
            }
          : {
              leftAction: { label: "Stage", icon: <Plus />, tone: "success", onTrigger: onStage },
              rightAction: {
                label: "Discard",
                icon: <Undo2 />,
                tone: "danger",
                onTrigger: onDiscard,
              },
            })}
      >
        {row}
      </SwipeRow>
      <ActionSheet
        open={menu}
        onOpenChange={setMenu}
        title={file.path}
        items={
          staged
            ? [{ id: "unstage", label: "Unstage", icon: <Minus />, onSelect: onUnstage }]
            : [
                { id: "stage", label: "Stage", icon: <Plus />, onSelect: onStage },
                {
                  id: "discard",
                  label: "Discard changes",
                  icon: <Undo2 />,
                  destructive: true,
                  onSelect: onDiscard,
                },
              ]
        }
      />
    </>
  );
}
