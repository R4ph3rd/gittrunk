import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { Sparkles } from "lucide-react";
import { useCommandStore, type CommandContext } from "@/app/commands";
import { detectPlatform } from "@/app/shortcuts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  SegmentedControl,
  Switch,
} from "@/design/components";
import { cn } from "@/lib/cn";
import { useAppInfo } from "@/ipc/queries";
import type { CommitOrder, PullStrategy, ThemePreference } from "@/ipc/bindings";
import { useRepoStore } from "@/stores/repo";
import { updateSettings, useSettings, useSettingsStore, type SectionId } from "@/stores/settings";
import { KeyboardSection } from "./KeyboardSection";

export const AI_SETTINGS_COMMAND = "ai.settings";
const DOCS_URL = "https://github.com/R4ph3rd/gittrunk#readme";
const RUN_DELAY_MS = 60;

function Row({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={htmlFor} className="text-base text-fg">
          {title}
        </Label>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function General() {
  const s = useSettings();
  return (
    <>
      <Row title="Theme" description="Follow the system or pick a fixed appearance.">
        <SegmentedControl<ThemePreference>
          aria-label="Theme"
          value={s.theme}
          onValueChange={(theme) => void updateSettings({ theme })}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "system", label: "System" },
          ]}
        />
      </Row>
      <Row
        title="Confirm destructive actions"
        description="Ask before discarding changes, force pushing or deleting branches."
        htmlFor="settings-confirm"
      >
        <Switch
          id="settings-confirm"
          checked={s.confirmDestructive}
          onCheckedChange={(confirmDestructive) => void updateSettings({ confirmDestructive })}
        />
      </Row>
    </>
  );
}

function Git() {
  const s = useSettings();
  const [path, setPath] = useState(s.gitPath ?? "");
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState(String(s.diffContextLines));

  // Re-sync drafts when the saved value changes (rollback, external update).
  const [seenPath, setSeenPath] = useState(s.gitPath);
  if (seenPath !== s.gitPath) {
    setSeenPath(s.gitPath);
    setPath(s.gitPath ?? "");
  }
  const [seenContext, setSeenContext] = useState(s.diffContextLines);
  if (seenContext !== s.diffContextLines) {
    setSeenContext(s.diffContextLines);
    setContext(String(s.diffContextLines));
  }

  const commitPath = async (value: string) => {
    const next = value.trim() === "" ? null : value.trim();
    if (next === s.gitPath) {
      setError(null);
      return;
    }
    const result = await updateSettings({ gitPath: next });
    setError(result.ok ? null : result.message);
  };

  const browse = async () => {
    const picked = await pickFile({ multiple: false, directory: false });
    if (typeof picked !== "string") return;
    setPath(picked);
    await commitPath(picked);
  };

  const commitContext = () => {
    const n = Math.round(Number(context));
    const clamped = Number.isFinite(n) ? Math.min(20, Math.max(0, n)) : s.diffContextLines;
    setContext(String(clamped));
    if (clamped !== s.diffContextLines) void updateSettings({ diffContextLines: clamped });
  };

  return (
    <>
      <div className="border-b border-border py-3">
        <Label htmlFor="settings-git-path" className="text-base text-fg">
          Git executable path
        </Label>
        <p className="mb-2 text-sm text-fg-muted">Leave empty to use git from PATH.</p>
        <div className="flex gap-2">
          <Input
            id="settings-git-path"
            value={path}
            placeholder="git"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "settings-git-path-error" : undefined}
            onChange={(e) => {
              setPath(e.target.value);
              setError(null);
            }}
            onBlur={() => void commitPath(path)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitPath(path);
            }}
          />
          <Button onClick={() => void browse()}>Browse…</Button>
        </div>
        {error ? (
          <p id="settings-git-path-error" role="alert" className="mt-1 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <Row
        title="Default pull strategy"
        description="Used by Pull when a branch has no preference."
      >
        <SegmentedControl<PullStrategy>
          aria-label="Default pull strategy"
          value={s.pullStrategy}
          onValueChange={(pullStrategy) => void updateSettings({ pullStrategy })}
          options={[
            { value: "merge", label: "Merge" },
            { value: "rebase", label: "Rebase" },
            { value: "ffOnly", label: "Fast-forward only" },
          ]}
        />
      </Row>
      <Row title="Graph order" description="How commits are ordered in the graph.">
        <SegmentedControl<CommitOrder>
          aria-label="Graph order"
          value={s.graphOrder}
          onValueChange={(graphOrder) => void updateSettings({ graphOrder })}
          options={[
            { value: "topo", label: "Topological" },
            { value: "date", label: "Date" },
          ]}
        />
      </Row>
      <Row
        title="Diff context lines"
        description="Unchanged lines shown around each change (0 to 20)."
        htmlFor="settings-context"
      >
        <Input
          id="settings-context"
          type="number"
          min={0}
          max={20}
          step={1}
          className="w-16"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          onBlur={commitContext}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitContext();
          }}
        />
      </Row>
    </>
  );
}

function useRunCommand() {
  const queryClient = useQueryClient();
  return (id: string) => {
    const cmd = useCommandStore.getState().commands[id];
    if (!cmd) return;
    const ctx: CommandContext = {
      repoId: useRepoStore.getState().activeId,
      queryClient,
      platform: detectPlatform(),
      openPalette: () => useCommandStore.getState().setPaletteOpen(true),
      openShortcutsHelp: () => useCommandStore.getState().setHelpOpen(true),
    };
    // Let the dialog close first so focus changes made by the command stick.
    setTimeout(() => {
      void Promise.resolve(cmd.run(ctx)).catch((e: unknown) => console.error(e));
    }, RUN_DELAY_MS);
  };
}

function Ai() {
  const run = useRunCommand();
  const close = useSettingsStore((s) => s.closeDialog);
  return (
    <Row
      title="AI assistance"
      description="Provider, model and privacy options live in AI settings."
    >
      <Button
        onClick={() => {
          close();
          run(AI_SETTINGS_COMMAND);
        }}
      >
        <Sparkles />
        Configure AI in AI settings
      </Button>
    </Row>
  );
}

function About() {
  const info = useAppInfo();
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 py-3 text-base">
      <dt className="text-fg-muted">Version</dt>
      <dd>{info.data?.version ?? "…"}</dd>
      <dt className="text-fg-muted">Git</dt>
      <dd>{info.data ? (info.data.gitVersion ?? "Not found on PATH") : "…"}</dd>
      <dt className="text-fg-muted">Platform</dt>
      <dd>{info.data?.platform ?? "…"}</dd>
      <dt className="text-fg-muted">Documentation</dt>
      <dd>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
        >
          gittrunk documentation
        </a>
      </dd>
    </dl>
  );
}

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "git", label: "Git" },
  { id: "keyboard", label: "Keyboard" },
  { id: "ai", label: "AI" },
  { id: "about", label: "About" },
];

/** The settings dialog. Opened with `openSettings()`, the "Settings" command or `mod+,`. */
export function SettingsDialog() {
  const open = useSettingsStore((s) => s.open);
  const section = useSettingsStore((s) => s.section);
  const setSection = useSettingsStore((s) => s.setSection);
  const closeDialog = useSettingsStore((s) => s.closeDialog);
  const hasAi = useCommandStore((s) => AI_SETTINGS_COMMAND in s.commands);
  const sections = SECTIONS.filter((s) => s.id !== "ai" || hasAi);
  const active = sections.some((s) => s.id === section) ? section : "general";
  const label = sections.find((s) => s.id === active)?.label ?? "General";

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : closeDialog())}>
      <DialogContent className="flex h-[min(34rem,85vh)] w-[min(46rem,94vw)] max-w-none gap-0 p-0">
        <nav
          aria-label="Settings sections"
          className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border bg-bg-subtle p-2"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === active ? "page" : undefined}
              onClick={() => setSection(s.id)}
              className={cn(
                "h-[var(--control-md)] rounded-md px-2 text-left text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
                s.id === active
                  ? "bg-surface-hover font-medium text-fg"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg",
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>{label}</DialogDescription>
          </DialogHeader>
          <div role="region" aria-label={label}>
            {active === "general" ? <General /> : null}
            {active === "git" ? <Git /> : null}
            {active === "keyboard" ? <KeyboardSection /> : null}
            {active === "ai" ? <Ai /> : null}
            {active === "about" ? <About /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
