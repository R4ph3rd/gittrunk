# Command registry

Every user-facing action is a `Command` reachable from the palette (`mod+k`, `mod+shift+p`)
and, when it has a `shortcut`, from the keyboard. `?` lists all shortcuts.

```ts
import { useRegisterCommands } from "@/app/commands";
import { GitBranch } from "lucide-react";

useRegisterCommands(
  [
    {
      id: "branch.create", // unique, dotted by feature
      title: "Create branch",
      group: "Branches", // palette heading
      icon: GitBranch, // optional lucide component
      shortcut: "mod+shift+b", // "mod+k", "g b" (sequence), or ["a", "b"]
      allowInInput: false, // true: also fire while typing in an input
      keywords: ["new", "checkout"],
      when: (ctx) => ctx.repoId !== null,
      run: (ctx) => openCreateBranchDialog(ctx.repoId!),
    },
  ],
  [openCreateBranchDialog], // deps, like useEffect: re-registers when they change
);
```

- `useRegisterCommands(commands, deps)` registers on mount and unregisters on unmount.
  Call it from a component that stays mounted while the command should exist.
- `ctx` (`CommandContext`): `repoId` (active repo or null), `queryClient`, `platform`
  (`"mac" | "other"`), `openPalette()`, `openShortcutsHelp()`. `when` and `run` receive the
  current one. For anything else, read Zustand stores with `useXStore.getState()` inside `run`.
- `mod` is Cmd on macOS and Ctrl elsewhere. Symbol keys such as `?` ignore Shift.
- Display a shortcut with `formatShortcut("mod+k")` from `@/app/shortcuts`
  (`⌘K` on macOS, `Ctrl+K` elsewhere), e.g. `<Tooltip shortcut={formatShortcut(...)}>`.
- Conflicting shortcuts (identical, or a chord shadowing a sequence) log a dev warning.
- Built-ins live in `builtin.ts`; do not edit them for feature commands, register your own.
- Shortcuts run only when focus is outside inputs unless `allowInInput` is set.
- The palette runs commands ~60 ms after closing so focus changes made by `run` stick.
