import { useEffect, useMemo, useState } from "react";
import { effectiveShortcut, useCommandStore, type Command } from "@/app/commands";
import {
  detectPlatform,
  findConflicts,
  formatShortcut,
  normalizeShortcut,
  type ShortcutOwner,
} from "@/app/shortcuts";
import { Button, Kbd } from "@/design/components";
import { useSettingsStore, type Overrides } from "@/stores/settings";
import { chordFromEvent } from "./chord";

const platform = detectPlatform();

const asList = (s: string | string[] | undefined) => (Array.isArray(s) ? s : s ? [s] : []);

interface Pending {
  id: string;
  chord: string;
  /** Titles of the commands the chord collides with. */
  conflicts: string[];
}

/** Table of every registered command with its shortcut; click Record to rebind. */
export function KeyboardSection() {
  const commands = useCommandStore((s) => s.commands);
  const overrides = useSettingsStore((s) => s.overrides);
  const save = useSettingsStore((s) => s.saveOverrides);
  const [recording, setRecording] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const list = useMemo(
    () =>
      Object.values(commands).sort(
        (a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title),
      ),
    [commands],
  );

  const assign = (cmd: Command, chord: string) => {
    const next: Overrides = { ...overrides };
    const def = asList(cmd.shortcut)[0];
    if (def && normalizeShortcut(def, platform) === normalizeShortcut(chord, platform)) {
      delete next[cmd.id];
    } else next[cmd.id] = chord;
    void save(next);
  };

  const conflictsFor = (cmd: Command, chord: string): string[] => {
    const owners: ShortcutOwner[] = [{ id: cmd.id, shortcut: chord }];
    for (const c of list) {
      if (c.id === cmd.id) continue;
      for (const s of asList(effectiveShortcut(c, overrides)))
        owners.push({ id: c.id, shortcut: s });
    }
    const ids = new Set<string>();
    for (const conflict of findConflicts(owners, platform)) {
      if (conflict.ids.includes(cmd.id)) conflict.ids.forEach((i) => i !== cmd.id && ids.add(i));
    }
    return [...ids].map((i) => commands[i]?.title ?? i);
  };

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Capture phase on window: runs before Radix's Escape handling and the global matcher.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      const chord = chordFromEvent(e, platform);
      const cmd = useCommandStore.getState().commands[recording];
      if (!chord || !cmd) return;
      setRecording(null);
      const conflicts = conflictsFor(cmd, chord);
      if (conflicts.length > 0) setPending({ id: cmd.id, chord, conflicts });
      else assign(cmd, chord);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handler reads the latest state via closure of this render
  }, [recording, overrides, list]);

  const clear = (cmd: Command) => {
    const next: Overrides = { ...overrides };
    if (cmd.shortcut) next[cmd.id] = null;
    else delete next[cmd.id];
    void save(next);
  };

  const reset = (cmd: Command) => {
    const next: Overrides = { ...overrides };
    delete next[cmd.id];
    void save(next);
  };

  const recordingTitle = recording ? commands[recording]?.title : undefined;
  const pendingCmd = pending ? commands[pending.id] : undefined;

  return (
    <div className="flex flex-col gap-3 py-2">
      <p role="status" aria-live="assertive" className="min-h-4 text-sm text-fg-muted">
        {recordingTitle
          ? `Recording shortcut for ${recordingTitle}. Press a key combination, or Escape to cancel.`
          : ""}
      </p>
      {pending && pendingCmd ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning bg-surface p-2 text-base"
        >
          <span>
            {formatShortcut(pending.chord, platform)} is already used by{" "}
            {pending.conflicts.join(", ")}.
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                assign(pendingCmd, pending.chord);
                setPending(null);
              }}
            >
              Assign anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </span>
        </div>
      ) : null}
      <table className="w-full border-collapse text-base">
        <thead>
          <tr className="text-left text-xs text-fg-subtle">
            <th scope="col" className="py-1 font-medium">
              Command
            </th>
            <th scope="col" className="py-1 font-medium">
              Shortcut
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((cmd) => {
            const shortcuts = asList(effectiveShortcut(cmd, overrides));
            const overridden = Object.prototype.hasOwnProperty.call(overrides, cmd.id);
            const isRecording = recording === cmd.id;
            return (
              <tr key={cmd.id} className="border-t border-border">
                <td className="py-1.5 pr-2">
                  <div>{cmd.title}</div>
                  <div className="text-xs text-fg-subtle">{cmd.group}</div>
                </td>
                <td className="py-1.5 pr-2">
                  {isRecording ? (
                    <span className="text-fg-muted">Press keys…</span>
                  ) : shortcuts.length > 0 ? (
                    <span className="flex gap-1">
                      {shortcuts.map((s) => (
                        <Kbd key={s}>{formatShortcut(s, platform)}</Kbd>
                      ))}
                    </span>
                  ) : (
                    <span className="text-fg-subtle">None</span>
                  )}
                </td>
                <td className="py-1.5 text-right">
                  <span className="inline-flex gap-1">
                    <Button
                      size="xs"
                      aria-pressed={isRecording}
                      aria-label={`Record shortcut for ${cmd.title}`}
                      onClick={() => {
                        setPending(null);
                        setRecording(isRecording ? null : cmd.id);
                      }}
                    >
                      {isRecording ? "Recording" : "Record"}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Clear shortcut for ${cmd.title}`}
                      disabled={shortcuts.length === 0}
                      onClick={() => clear(cmd)}
                    >
                      Clear
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Reset shortcut for ${cmd.title}`}
                      disabled={!overridden}
                      onClick={() => reset(cmd)}
                    >
                      Reset
                    </Button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
