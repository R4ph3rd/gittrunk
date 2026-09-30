import {
  ArrowLeftToLine,
  ArrowRightToLine,
  CircleDot,
  FolderOpen,
  Keyboard,
  Moon,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { commands as backend } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { queryKeys } from "@/ipc/queries";
import { useRepoStore } from "@/stores/repo";
import { useTheme } from "@/design/theme";
import { useRegisterCommands, type Command, type CommandContext } from "./registry";

const hasRepo = (ctx: CommandContext) => ctx.repoId !== null;

async function openRepository(ctx: CommandContext) {
  const { addRepo, setOpenError } = useRepoStore.getState();
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  try {
    addRepo(await unwrap(backend.repoOpen(picked)));
    void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.recent });
  } catch (err) {
    setOpenError(err instanceof Error ? err.message : String(err));
  }
}

async function closeActiveRepo(ctx: CommandContext) {
  const id = ctx.repoId;
  if (!id) return;
  useRepoStore.getState().removeRepo(id);
  ctx.queryClient.removeQueries({ queryKey: queryKeys.repo(id) });
  await backend.repoClose(id);
}

function cycleTab(step: 1 | -1) {
  const { repos, activeId, setActive } = useRepoStore.getState();
  if (repos.length < 2) return;
  const at = repos.findIndex((r) => r.id === activeId);
  const next = repos[(at + step + repos.length) % repos.length];
  if (next) setActive(next.id);
}

function focusGraphSearch() {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search commits"]');
  input?.focus();
  input?.select();
}

async function goToHead(ctx: CommandContext) {
  const id = ctx.repoId;
  if (!id) return;
  const info = await ctx.queryClient.fetchQuery({
    queryKey: queryKeys.info(id),
    queryFn: () => unwrap(backend.repoInfo(id)),
  });
  if (info.head.kind !== "unborn") useRepoStore.getState().selectCommit(id, info.head.oid);
}

/** ThemeProvider is optional so the shell (and its tests) work without it. */
function useOptionalTheme() {
  try {
    return useTheme();
  } catch {
    return null;
  }
}

/** Registers the built-in app commands. Mount once, inside the app shell. */
export function useBuiltinCommands() {
  const theme = useOptionalTheme();
  const resolved = theme?.resolvedTheme;
  const setTheme = theme?.setTheme;

  const list: Command[] = [
    {
      id: "repo.open",
      title: "Open repository",
      group: "Repository",
      icon: FolderOpen,
      shortcut: "mod+o",
      keywords: ["folder", "clone", "add"],
      run: openRepository,
    },
    {
      id: "repo.close",
      title: "Close repository tab",
      group: "Repository",
      icon: X,
      shortcut: "mod+w",
      when: hasRepo,
      run: closeActiveRepo,
    },
    {
      id: "repo.nextTab",
      title: "Next repository tab",
      group: "Repository",
      icon: ArrowRightToLine,
      shortcut: "ctrl+tab",
      when: () => useRepoStore.getState().repos.length > 1,
      run: () => cycleTab(1),
    },
    {
      id: "repo.prevTab",
      title: "Previous repository tab",
      group: "Repository",
      icon: ArrowLeftToLine,
      shortcut: "ctrl+shift+tab",
      when: () => useRepoStore.getState().repos.length > 1,
      run: () => cycleTab(-1),
    },
    {
      id: "repo.refresh",
      title: "Refresh",
      group: "Repository",
      icon: RefreshCw,
      shortcut: "mod+r",
      keywords: ["reload", "invalidate"],
      when: hasRepo,
      run: (ctx) => {
        if (ctx.repoId) {
          void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.repo(ctx.repoId) });
        }
      },
    },
    {
      id: "graph.focusSearch",
      title: "Focus graph search",
      group: "Graph",
      icon: Search,
      shortcut: "mod+f",
      allowInInput: true,
      keywords: ["find", "commits"],
      when: hasRepo,
      run: focusGraphSearch,
    },
    {
      id: "graph.goToHead",
      title: "Go to HEAD",
      group: "Graph",
      icon: CircleDot,
      keywords: ["current", "commit", "select"],
      when: hasRepo,
      run: goToHead,
    },
    ...(setTheme
      ? [
          {
            id: "view.toggleTheme",
            title: "Toggle theme",
            group: "View",
            icon: Moon,
            keywords: ["dark", "light", "appearance"],
            run: () => setTheme(resolved === "dark" ? "light" : "dark"),
          } satisfies Command,
        ]
      : []),
    {
      id: "help.shortcuts",
      title: "Show keyboard shortcuts",
      group: "Help",
      icon: Keyboard,
      shortcut: "?",
      keywords: ["help", "keys", "hotkeys"],
      run: (ctx) => ctx.openShortcutsHelp(),
    },
  ];

  useRegisterCommands(list, [resolved, setTheme]);
}
