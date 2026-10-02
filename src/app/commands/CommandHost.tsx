import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CommandPalette,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Kbd,
  type CommandGroupDef,
} from "@/design/components";
import { useRepoStore } from "@/stores/repo";
import {
  createMatcher,
  detectPlatform,
  findConflicts,
  formatShortcut,
  isEditableTarget,
  type Binding,
} from "../shortcuts";
import { useBuiltinCommands } from "./builtin";
import {
  effectiveShortcut,
  useCommandStore,
  useRegisterCommands,
  type Command,
  type CommandContext,
} from "./registry";

const platform = detectPlatform();
/** Delay before a palette-run command executes, so the dialog's focus restore cannot steal focus. */
const RUN_DELAY_MS = 60;

const firstShortcut = (shortcut: string | string[] | undefined) =>
  Array.isArray(shortcut) ? shortcut[0] : shortcut;
const listOf = (shortcut: string | string[] | undefined) =>
  Array.isArray(shortcut) ? shortcut : shortcut ? [shortcut] : [];

const PALETTE_COMMANDS: Command[] = [
  {
    id: "palette.open",
    title: "Open command palette",
    group: "Help",
    shortcut: ["mod+k", "mod+shift+p"],
    allowInInput: true,
    run: (ctx) => ctx.openPalette(),
  },
];

/**
 * Mounts the command system: builtin commands, the global shortcut listener, the command
 * palette and the keyboard shortcuts help dialog. Render once inside the app shell.
 */
export function CommandHost() {
  const queryClient = useQueryClient();
  const activeId = useRepoStore((s) => s.activeId);
  const pageKind = useRepoStore((s) => s.page.kind);
  // Repo commands never act on a repository hidden behind Home or a new tab.
  const repoId = pageKind === "repo" ? activeId : null;
  const commands = useCommandStore((s) => s.commands);
  const paletteOpen = useCommandStore((s) => s.paletteOpen);
  const helpOpen = useCommandStore((s) => s.helpOpen);
  const recent = useCommandStore((s) => s.recent);
  const overrides = useCommandStore((s) => s.shortcutOverrides);
  const { setPaletteOpen, setHelpOpen, markUsed } = useCommandStore.getState();

  const ctx = useMemo<CommandContext>(
    () => ({
      repoId,
      queryClient,
      platform,
      openPalette: () => useCommandStore.getState().setPaletteOpen(true),
      openShortcutsHelp: () => useCommandStore.getState().setHelpOpen(true),
    }),
    [repoId, queryClient],
  );
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  useRegisterCommands(PALETTE_COMMANDS);
  useBuiltinCommands();

  const execute = useCallback(
    (cmd: Command) => {
      markUsed(cmd.id);
      void Promise.resolve(cmd.run(ctxRef.current)).catch((err: unknown) => {
        console.error(`Command ${cmd.id} failed`, err);
      });
    },
    [markUsed],
  );

  const all = useMemo(() => Object.values(commands), [commands]);
  // `when` may read stores, so it is re-evaluated on every render, not memoised on `ctx` alone.
  const available = all.filter((c) => !c.when || c.when(ctx));

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const owners = all.flatMap((c) =>
      listOf(effectiveShortcut(c, overrides)).map((s) => ({ id: c.id, shortcut: s })),
    );
    for (const conflict of findConflicts(owners, platform)) {
      console.warn(
        `[shortcuts] ${conflict.kind} conflict on "${conflict.shortcut}": ${conflict.ids.join(", ")}`,
      );
    }
  }, [all, overrides]);

  const matcher = useMemo(() => createMatcher(platform), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      const c = ctxRef.current;
      const list = Object.values(useCommandStore.getState().commands).filter(
        (x) => !x.when || x.when(c),
      );
      const overrides = useCommandStore.getState().shortcutOverrides;
      const bindings: Binding[] = [];
      for (const c of list) {
        const shortcut = effectiveShortcut(c, overrides);
        if (shortcut) bindings.push({ id: c.id, shortcut, allowInInput: c.allowInInput });
      }
      const id = matcher.handle(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          inInput: isEditableTarget(e.target),
        },
        bindings,
      );
      const cmd = id ? list.find((c) => c.id === id) : undefined;
      if (!cmd) return;
      e.preventDefault();
      execute(cmd);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [matcher, execute]);

  const groups = useMemo<CommandGroupDef[]>(() => {
    if (!paletteOpen) return [];
    const toItem = (c: Command) => {
      const sc = firstShortcut(effectiveShortcut(c, overrides));
      return {
        id: c.id,
        label: c.title,
        icon: c.icon ? <c.icon /> : undefined,
        shortcut: sc ? formatShortcut(sc, platform) : undefined,
        keywords: c.keywords,
        onSelect: () => {
          setTimeout(() => execute(c), RUN_DELAY_MS);
        },
      };
    };
    const shown = available.filter((c) => c.id !== "palette.open");
    const recents = recent
      .map((id) => shown.find((c) => c.id === id))
      .filter((c): c is Command => c !== undefined);
    const rest = shown.filter((c) => !recents.includes(c));
    const byGroup = new Map<string, Command[]>();
    for (const c of rest) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
    const out: CommandGroupDef[] = [];
    if (recents.length > 0) out.push({ heading: "Recent", items: recents.map(toItem) });
    for (const [heading, items] of byGroup) out.push({ heading, items: items.map(toItem) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `available` derives from `commands`/`ctx`
  }, [paletteOpen, commands, ctx, recent, execute, overrides]);

  const helpGroups = useMemo(() => {
    const byGroup = new Map<string, Command[]>();
    for (const c of all.filter((c) => effectiveShortcut(c, overrides))) {
      byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
    }
    return [...byGroup];
  }, [all, overrides]);

  return (
    <>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={groups} />
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-h-[80vh] max-w-md overflow-auto">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Press {formatShortcut("mod+k", platform)} to search every command.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {helpGroups.map(([group, cmds]) => (
              <section key={group} aria-label={group}>
                <h3 className="mb-1 text-xs font-medium text-fg-subtle">{group}</h3>
                <ul className="flex flex-col gap-1">
                  {cmds.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 text-base">
                      <span>{c.title}</span>
                      <span className="flex gap-1">
                        {listOf(effectiveShortcut(c, overrides)).map((s) => (
                          <Kbd key={s}>{formatShortcut(s, platform)}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
