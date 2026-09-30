import { useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/design/components";
import { useCommitDetails } from "@/ipc/queries";
import { selectedOidOf, useRepoStore } from "@/stores/repo";
import { openBlame, openFileHistory, useHistoryViews, type PathPromptMode } from "./store";

const MAX_SUGGESTIONS = 8;

/** Asks for a file path (palette "Blame file…" / "File history…"), suggesting the selected commit's files. */
export function PathPromptDialog({ repoId }: { repoId: string }) {
  const stored = useHistoryViews((s) => s.prompt);
  const prompt = stored?.repoId === repoId ? stored : null;
  const close = useHistoryViews((s) => s.closePrompt);
  return (
    <Dialog open={prompt !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {prompt && <Form key={prompt.mode} repoId={prompt.repoId} mode={prompt.mode} />}
      </DialogContent>
    </Dialog>
  );
}

function Form({ repoId, mode }: { repoId: string; mode: PathPromptMode }) {
  const oid = useRepoStore((s) => selectedOidOf(s.selection[repoId]));
  const details = useCommitDetails(repoId, oid);
  const [path, setPath] = useState("");
  const suggestions = useMemo(() => {
    const needle = path.trim().toLowerCase();
    return (details.data?.files ?? [])
      .map((f) => f.path)
      .filter((p) => p.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }, [details.data, path]);

  const go = (target: string) => {
    const p = target.trim();
    if (!p) return;
    if (mode === "blame") openBlame(repoId, p, null);
    else openFileHistory(repoId, p);
  };

  const title = mode === "blame" ? "Blame file" : "File history";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(path);
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Path relative to the repository root
          {suggestions.length > 0 ? "; files of the selected commit are suggested." : "."}
        </DialogDescription>
      </DialogHeader>
      <Input
        aria-label="File path"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="src/main.rs"
        autoFocus
      />
      {suggestions.length > 0 && (
        <ul aria-label="Suggested files" className="mt-2 max-h-48 overflow-auto">
          {suggestions.map((p) => (
            <li key={p}>
              <button
                type="button"
                onClick={() => go(p)}
                className="h-6 w-full truncate rounded-sm px-2 text-left font-mono text-xs hover:bg-surface-hover"
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}
      <DialogFooter>
        <Button type="submit" variant="primary" disabled={!path.trim()}>
          {title}
        </Button>
      </DialogFooter>
    </form>
  );
}
