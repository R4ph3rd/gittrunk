import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { Compartment, EditorState, Prec, StateField, type Range } from "@codemirror/state";
import {
  Decoration,
  keymap,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import { gittrunkTheme, loadLanguage } from "./cm";
import {
  blockEdit,
  nextBlock,
  parseConflicts,
  type BlockChoice,
  type ConflictBlock,
} from "./markers";
import "./conflicts.css";

const CHOICES: { choice: BlockChoice; label: string }[] = [
  { choice: "ours", label: "Accept ours" },
  { choice: "theirs", label: "Accept theirs" },
  { choice: "both", label: "Accept both" },
  { choice: "base", label: "Accept base" },
];

/** Per-block button bar rendered above the `<<<<<<<` line. */
class BlockActions extends WidgetType {
  constructor(
    readonly index: number,
    readonly hasBase: boolean,
    readonly title: string,
  ) {
    super();
  }
  eq(other: BlockActions) {
    return (
      other.index === this.index && other.hasBase === this.hasBase && other.title === this.title
    );
  }
  toDOM(view: EditorView) {
    const bar = document.createElement("div");
    bar.className = "gt-conflict-actions";
    bar.contentEditable = "false";
    const title = document.createElement("span");
    title.className = "gt-conflict-title";
    title.textContent = this.title;
    bar.append(title);
    for (const { choice, label } of CHOICES) {
      if (choice === "base" && !this.hasBase) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => {
        // Re-parse at click time: earlier edits may have shifted this block.
        const doc = view.state.doc.toString();
        const block = parseConflicts(doc).find((b) => b.index === this.index);
        const edit = block && blockEdit(block, choice, doc.length, "\n");
        if (edit) view.dispatch({ changes: edit, userEvent: "input.conflict" });
        view.focus();
      });
      bar.append(button);
    }
    return bar;
  }
  ignoreEvent() {
    return true;
  }
}

const lineDeco = (cls: string) => Decoration.line({ class: cls });
const DECO = {
  ours: lineDeco("gt-conflict-ours"),
  theirs: lineDeco("gt-conflict-theirs"),
  base: lineDeco("gt-conflict-base"),
  marker: lineDeco("gt-conflict-marker"),
};

function buildDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  const blocks = parseConflicts(doc.toString());
  const ranges: Range<Decoration>[] = [];
  for (const b of blocks) {
    const first = doc.line(b.startLine + 1);
    ranges.push(
      Decoration.widget({
        widget: new BlockActions(
          b.index,
          b.base !== null,
          `Conflict ${b.index + 1}: ${b.oursLabel || "ours"} / ${b.theirsLabel || "theirs"}`,
        ),
        block: true,
        side: -1,
      }).range(first.from),
    );
    let section: keyof typeof DECO = "ours";
    for (let n = b.startLine; n <= b.endLine; n++) {
      const line = doc.line(n + 1);
      const text = line.text;
      let deco = DECO[section];
      if (n === b.startLine || n === b.endLine) deco = DECO.marker;
      else if (section === "ours" && b.base !== null && text.startsWith("|||||||")) {
        section = "base";
        deco = DECO.marker;
      } else if (text === "=======" && section !== "theirs") {
        section = "theirs";
        deco = DECO.marker;
      }
      ranges.push(deco.range(line.from));
    }
  }
  return Decoration.set(ranges, true);
}

const conflictField = StateField.define<DecorationSet>({
  create: buildDecorations,
  update: (value, tr) => (tr.docChanged ? buildDecorations(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
});

function jump(view: EditorView, dir: 1 | -1): boolean {
  const blocks: ConflictBlock[] = parseConflicts(view.state.doc.toString());
  const i = nextBlock(blocks, view.state.selection.main.head, dir);
  if (i < 0) return false;
  view.dispatch({
    selection: { anchor: blocks[i]!.from },
    effects: EditorView.scrollIntoView(blocks[i]!.from, { y: "center" }),
  });
  return true;
}

export interface ResultHandle {
  next: () => void;
  prev: () => void;
  /** Replaces the whole document (used by AI suggestions). */
  setText: (text: string) => void;
}

interface ResultProps {
  /** Initial document. Changing it after mount has no effect; use `handle.setText`. */
  initial: string;
  path: string;
  onChange: (text: string) => void;
  handle?: Ref<ResultHandle>;
}

/** The editable middle pane: conflict blocks with per-block actions, `alt+up/down` navigation. */
export function ResultEditor({ initial, path, onChange, handle }: ResultProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useImperativeHandle(handle, () => ({
    next: () => view.current && jump(view.current, 1),
    prev: () => view.current && jump(view.current, -1),
    setText: (text) => {
      const v = view.current;
      if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
    },
  }));

  useEffect(() => {
    const language = new Compartment();
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          Prec.highest(
            keymap.of([
              { key: "Alt-ArrowDown", run: (e) => jump(e, 1) },
              { key: "Alt-ArrowUp", run: (e) => jump(e, -1) },
            ]),
          ),
          basicSetup,
          gittrunkTheme,
          conflictField,
          language.of([]),
          EditorView.contentAttributes.of({ "aria-label": "Merged result" }),
          EditorView.updateListener.of((u: ViewUpdate) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    let live = true;
    void loadLanguage(path).then((ext) => {
      if (live && ext) v.dispatch({ effects: language.reconfigure(ext) });
    });
    return () => {
      live = false;
      v.destroy();
      view.current = null;
    };
    // The document is owned by CodeMirror after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return <div ref={host} className="gt-cm h-full min-h-0" data-testid="result-editor" />;
}

/** A read-only pane for the ours / theirs / base versions. */
export function ReadOnlyPane({
  value,
  path,
  label,
}: {
  value: string;
  path: string;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const language = new Compartment();
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          gittrunkTheme,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          language.of([]),
          EditorView.contentAttributes.of({ "aria-label": label }),
        ],
      }),
    });
    let live = true;
    void loadLanguage(path).then((ext) => {
      if (live && ext) v.dispatch({ effects: language.reconfigure(ext) });
    });
    return () => {
      live = false;
      v.destroy();
    };
  }, [value, path, label]);
  return <div ref={host} className="gt-cm h-full min-h-0" data-testid={`pane-${label}`} />;
}
