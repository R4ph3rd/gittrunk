import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@/design/components";
import { useKnownRepos } from "@/ipc/queries";
import { updateSettings, useSettings } from "@/stores/settings";
import { useHomeDialogs, type WorkspaceDialogTarget } from "./store";

const MAX_NAME = 64;

function Form({ target, onClose }: { target: WorkspaceDialogTarget; onClose: () => void }) {
  const settings = useSettings();
  const known = useKnownRepos();
  const existing =
    target.mode === "edit" ? settings.workspaces.find((w) => w.id === target.id) : undefined;
  const [name, setName] = useState(existing?.name ?? "");
  const [selected, setSelected] = useState<string[]>(existing?.repos ?? []);
  // Folders added by hand that are not in the known list.
  const [extra, setExtra] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const knownRepos = (known.data ?? []).filter((r) => r.exists);
  const knownPaths = new Set(knownRepos.map((r) => r.path));
  const listed = [
    ...knownRepos.map((r) => ({ path: r.path, name: r.name })),
    ...[...selected, ...extra]
      .filter((p, i, all) => !knownPaths.has(p) && all.indexOf(p) === i)
      .map((p) => ({ path: p, name: p.split(/[/\\]/).filter(Boolean).pop() ?? p })),
  ];

  const trimmed = name.trim();
  const nameError =
    trimmed === "" ? "Enter a name" : trimmed.length > MAX_NAME ? "At most 64 characters" : null;

  const toggle = (path: string, on: boolean) =>
    setSelected((s) => (on ? [...s, path] : s.filter((p) => p !== path)));

  const addFolder = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    setExtra((e) => (e.includes(picked) ? e : [...e, picked]));
    setSelected((s) => (s.includes(picked) ? s : [...s, picked]));
  };

  const save = async () => {
    setTouched(true);
    if (nameError) return;
    setBusy(true);
    setError(null);
    const next =
      target.mode === "edit"
        ? settings.workspaces.map((w) =>
            w.id === target.id ? { ...w, name: trimmed, repos: selected } : w,
          )
        : [...settings.workspaces, { id: crypto.randomUUID(), name: trimmed, repos: selected }];
    const result = await updateSettings({ workspaces: next });
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.message);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{target.mode === "edit" ? "Edit workspace" : "New workspace"}</DialogTitle>
        <DialogDescription>
          A workspace is a named group of repositories you can open together.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="ws-name">Name</Label>
          <Input
            id="ws-name"
            value={name}
            autoFocus
            maxLength={MAX_NAME + 16}
            aria-invalid={touched && nameError ? "true" : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {touched && nameError && (
            <p role="alert" className="text-sm text-danger">
              {nameError}
            </p>
          )}
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm text-fg-muted">Repositories</legend>
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
            {listed.length === 0 && (
              <li className="text-sm text-fg-subtle">No known repositories yet.</li>
            )}
            {listed.map((r) => (
              <li key={r.path} className="flex flex-col">
                <Checkbox
                  label={r.name}
                  checked={selected.includes(r.path)}
                  onCheckedChange={(on) => toggle(r.path, on)}
                />
                <span className="ml-5 truncate font-mono text-xs text-fg-subtle">{r.path}</span>
              </li>
            ))}
          </ul>
          <Button type="button" className="self-start" onClick={() => void addFolder()}>
            <FolderPlus />
            Add folder…
          </Button>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function WorkspaceDialog() {
  const target = useHomeDialogs((s) => s.workspace);
  const close = useHomeDialogs((s) => s.close);
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        {target && <Form target={target} onClose={close} />}
      </DialogContent>
    </Dialog>
  );
}
