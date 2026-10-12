import { Fragment, type ReactNode } from "react";
import {
  Copy,
  EyeOff,
  FileClock,
  FileDown,
  ClipboardCopy,
  Minus,
  Plus,
  Undo2,
  ExternalLink,
} from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/design/components";
import type { FileChange } from "@/ipc/bindings";
import { usePlatform } from "@/app/platform";
import { openFileHistory } from "@/features/history-views/store";
import { commonExtension, extensionPattern, ignorePattern } from "./pathActions";
import { usePathActions } from "./usePathActions";

export interface MenuTarget {
  section: "conflicted" | "unstaged" | "staged";
  /** A folder row (tree mode); otherwise one or more files. */
  folder: string | null;
  /** The files the actions apply to (a folder's files, or the row / selection). */
  files: FileChange[];
  /** The row the menu was opened on. */
  primary: string;
}

interface Props {
  repoId: string;
  target: MenuTarget;
  onToggleStage: () => void;
  onDiscard: () => void;
  onCopyPath: () => void;
}

/** Items of the Changes panel context menu, grouped: stage, discard, ignore, tools, copy. */
export function FileMenuContent({ repoId, target, onToggleStage, onDiscard, onCopyPath }: Props) {
  const platform = usePlatform();
  const actions = usePathActions(repoId);
  const { section, folder, files } = target;
  const staged = section === "staged";
  const conflicted = section === "conflicted";
  const paths = folder ? [folder] : files.map((f) => f.path);
  const count = files.length;
  const ext = folder ? null : commonExtension(paths);

  const stage = staged ? (
    <ContextMenuItem key="stage" icon={<Minus />} shortcut="Space" onSelect={onToggleStage}>
      Unstage
    </ContextMenuItem>
  ) : (
    <ContextMenuItem key="stage" icon={<Plus />} shortcut="Space" onSelect={onToggleStage}>
      Stage
    </ContextMenuItem>
  );

  const discard =
    !staged && !platform.readOnly ? (
      <ContextMenuItem
        key="discard"
        icon={<Undo2 />}
        shortcut="Del"
        destructive
        onSelect={onDiscard}
      >
        Discard changes
      </ContextMenuItem>
    ) : null;

  const patterns = folder
    ? [ignorePattern(folder, true)]
    : paths.map((p) => ignorePattern(p, false));
  const thisLabel = folder
    ? "Ignore folder"
    : count > 1
      ? `Ignore ${count} files`
      : "Ignore this file";
  const ignore =
    !conflicted && !platform.readOnly ? (
      <ContextMenuSub key="ignore">
        <ContextMenuSubTrigger icon={<EyeOff />}>Ignore</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onSelect={() => void actions.ignore(patterns, "gitignore")}>
            {thisLabel}
          </ContextMenuItem>
          {ext && (
            <ContextMenuItem
              onSelect={() => void actions.ignore([extensionPattern(ext)], "gitignore")}
            >
              {`Ignore all *.${ext} files`}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void actions.ignore(patterns, "exclude")}>
            Add to .git/info/exclude (local only)
          </ContextMenuItem>
          {ext && (
            <ContextMenuItem
              onSelect={() => void actions.ignore([extensionPattern(ext)], "exclude")}
            >
              {`Add *.${ext} to .git/info/exclude`}
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
    ) : null;

  const onlyUntracked = !staged && files.length > 0 && files.every((f) => f.status === "untracked");
  const tools: ReactNode[] = [];
  if (!conflicted) {
    if (platform.supportsExternalEditor && platform.hasGitCli && !onlyUntracked && count > 0) {
      tools.push(
        <ContextMenuItem
          key="difftool"
          icon={<ExternalLink />}
          onSelect={() => void actions.openDiffTool(folder ?? target.primary, staged)}
        >
          Open diff in external tool
        </ContextMenuItem>,
      );
    }
    if (!platform.mobile) {
      tools.push(
        <ContextMenuItem
          key="patch"
          icon={<FileDown />}
          onSelect={() => void actions.createPatch(paths, staged)}
        >
          Create patch…
        </ContextMenuItem>,
      );
    }
    tools.push(
      <ContextMenuItem
        key="copy-patch"
        icon={<ClipboardCopy />}
        onSelect={() => void actions.copyPatch(paths, staged)}
      >
        Copy patch
      </ContextMenuItem>,
    );
  }
  if (!folder && platform.supportsFileHistory) {
    tools.push(
      <ContextMenuItem
        key="history"
        icon={<FileClock />}
        onSelect={() => openFileHistory(repoId, target.primary)}
      >
        File history
      </ContextMenuItem>,
    );
  }

  const groups: ReactNode[][] = [
    [stage],
    discard ? [discard] : [],
    ignore ? [ignore] : [],
    tools,
    [
      <ContextMenuItem key="copy" icon={<Copy />} onSelect={onCopyPath}>
        Copy path
      </ContextMenuItem>,
    ],
  ].filter((g) => g.length > 0);

  return (
    <>
      {groups.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <ContextMenuSeparator />}
          {group}
        </Fragment>
      ))}
    </>
  );
}
