import { memo, useEffect, useMemo, useRef, type MouseEvent } from "react";
import { DiffModeEnum, DiffView, getLang } from "@git-diff-view/react";
import { MoreVertical } from "lucide-react";
import { Button, IconButton } from "@/design/components";
import { useLongPress } from "@/design/hooks";
import { cn } from "@/lib/cn";
import type { FileDiff } from "@/ipc/bindings";
import type { DiffMode } from "@/stores/repo";
import { parseKey, resolveRow, type LineRef } from "./selection";
import "./diff.css";

interface Props {
  diff: FileDiff;
  hunkIndex: number;
  /** This hunk as unified-diff text (`toHunkStrings(diff)[hunkIndex]`). */
  patch: string;
  mode: DiffMode;
  theme: "light" | "dark";
  staged: boolean;
  busy: boolean;
  selectedKeys: ReadonlySet<string>;
  onLineClick: (ref: LineRef, shift: boolean) => void;
  onStageHunk: (hunkIndex: number) => void;
  onUnstageHunk: (hunkIndex: number) => void;
  onDiscardHunk: (hunkIndex: number) => void;
  /** Compact layouts: 44px header buttons, no line selection, long-press opens `onHunkMenu`. */
  compact?: boolean;
  onHunkMenu?: (hunkIndex: number) => void;
}

/** Marks the rows of selected lines with `data-selected` (styled in diff.css). */
function markSelected(
  root: HTMLElement,
  diff: FileDiff,
  hunkIndex: number,
  keys: ReadonlySet<string>,
  mode: DiffMode,
) {
  root.querySelectorAll("[data-selected]").forEach((el) => el.removeAttribute("data-selected"));
  for (const key of keys) {
    const ref = parseKey(key);
    if (ref.hunk !== hunkIndex) continue;
    const line = diff.hunks[ref.hunk]?.lines[ref.line];
    if (!line) continue;
    const isDelete = line.kind === "delete";
    const n = isDelete ? line.oldLineno : line.newLineno;
    if (n === null) continue;
    const selector =
      mode === "split"
        ? `tr[data-side="${isDelete ? "old" : "new"}"] [data-line-num="${n}"]`
        : `[data-line-${isDelete ? "old" : "new"}-num="${n}"]`;
    root.querySelector(selector)?.closest("tr")?.setAttribute("data-selected", "");
  }
}

function HunkViewImpl({
  diff,
  hunkIndex,
  patch,
  mode,
  theme,
  staged,
  busy,
  selectedKeys,
  onLineClick,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  compact = false,
  onHunkMenu,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const longPress = useLongPress(() => onHunkMenu?.(hunkIndex), {
    disabled: !compact || !onHunkMenu,
  });
  const btn = compact ? "min-h-[var(--touch-target)]" : "";
  const hunk = diff.hunks[hunkIndex];
  const lang = getLang(diff.path);
  const data = useMemo(
    () => ({
      oldFile: { fileName: diff.oldPath ?? diff.path, fileLang: lang },
      newFile: { fileName: diff.path, fileLang: lang },
      hunks: [patch],
    }),
    [diff.oldPath, diff.path, lang, patch],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mark = () => markSelected(root, diff, hunkIndex, selectedKeys, mode);
    mark();
    // The viewer re-renders rows on its own (mode switch, highlighting); keep marks in sync.
    const observer = new MutationObserver(mark);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [diff, hunkIndex, selectedKeys, mode]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (compact) return; // line-level selection is desktop only in v1
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-state="diff"]');
    if (!tr) return;
    const ref = resolveRow(tr, diff, hunkIndex);
    if (ref) onLineClick(ref, e.shiftKey);
  };

  return (
    <section data-testid="diff-hunk" data-hunk={hunkIndex} className="border-b border-border">
      <header
        {...(compact ? longPress : {})}
        className={cn(
          "sticky top-0 z-[var(--z-sticky)] flex items-center gap-2 border-b border-border bg-bg-subtle px-2",
          compact ? "min-h-[var(--touch-target)] select-none" : "h-7",
        )}
      >
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-subtle">
          {hunk?.header}
        </code>
        {staged ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            className={btn}
            onClick={() => onUnstageHunk(hunkIndex)}
          >
            Unstage hunk
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              className={btn}
              onClick={() => onStageHunk(hunkIndex)}
            >
              Stage hunk
            </Button>
            {compact ? null : (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                className={cn("text-danger hover:text-danger", btn)}
                onClick={() => onDiscardHunk(hunkIndex)}
              >
                Discard hunk
              </Button>
            )}
          </>
        )}
        {compact && onHunkMenu ? (
          <IconButton aria-label="Hunk actions" onClick={() => onHunkMenu(hunkIndex)}>
            <MoreVertical />
          </IconButton>
        ) : null}
      </header>
      <div
        ref={rootRef}
        onClick={onClick}
        onMouseDown={(e) => {
          if (e.shiftKey) e.preventDefault(); // no text selection while extending a range
        }}
      >
        <DiffView
          data={data}
          diffViewMode={mode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified}
          diffViewTheme={theme}
          diffViewHighlight
          diffViewFontSize={12}
        />
      </div>
    </section>
  );
}

export const HunkView = memo(HunkViewImpl);
