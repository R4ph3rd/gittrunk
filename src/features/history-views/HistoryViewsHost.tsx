import { FileClock, FolderGit2, History, RefreshCw, ScrollText } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRegisterCommands } from "@/app/commands";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/design/components";
import { BlameView } from "./BlameView";
import { AddWorktreeDialog } from "./AddWorktreeDialog";
import { FileHistoryView } from "./FileHistoryView";
import { updateSubmodules } from "./submoduleOps";
import { PathPromptDialog } from "./PathPromptDialog";
import { ReflogView } from "./ReflogView";
import { revealCommit } from "./reveal";
import { openBlame, openFileHistory, openReflog, useHistoryViews } from "./store";

/**
 * Renders the blame / file history / reflog panel (a large dialog over the repo view), the path
 * prompt and the add-worktree dialog, and registers their palette commands. Mounted once per
 * repository by `RefsSidebar`.
 */
export function HistoryViewsHost({ repoId }: { repoId: string }) {
  const client = useQueryClient();
  const view = useHistoryViews((s) => s.view);
  const close = useHistoryViews((s) => s.close);
  const addWorktreeFor = useHistoryViews((s) => s.addWorktreeFor);
  const closeAdd = useHistoryViews((s) => s.closeAddWorktree);

  useRegisterCommands(
    [
      {
        id: "history.blame",
        title: "Blame file…",
        group: "History",
        icon: ScrollText,
        keywords: ["annotate", "who changed"],
        when: (ctx) => ctx.repoId === repoId,
        run: () => useHistoryViews.getState().openPrompt(repoId, "blame"),
      },
      {
        id: "history.fileHistory",
        title: "File history…",
        group: "History",
        icon: FileClock,
        keywords: ["log", "follow", "renames"],
        when: (ctx) => ctx.repoId === repoId,
        run: () => useHistoryViews.getState().openPrompt(repoId, "history"),
      },
      {
        id: "history.reflog",
        title: "Show reflog",
        group: "History",
        icon: History,
        keywords: ["head", "recover", "undo"],
        when: (ctx) => ctx.repoId === repoId,
        run: () => openReflog(repoId, "HEAD"),
      },
      {
        id: "worktree.add",
        title: "Add worktree…",
        group: "Repository",
        icon: FolderGit2,
        when: (ctx) => ctx.repoId === repoId,
        run: () => useHistoryViews.getState().openAddWorktree(repoId),
      },
      {
        id: "submodule.update",
        title: "Update all submodules",
        group: "Repository",
        icon: RefreshCw,
        when: (ctx) => ctx.repoId === repoId,
        run: () =>
          void updateSubmodules(
            client,
            repoId,
            { paths: [], init: true, recursive: true },
            "submodules",
          ),
      },
    ],
    [repoId, client],
  );

  const current = view && view.repoId === repoId ? view : null;
  const reveal = async (oid: string) => {
    if (await revealCommit(repoId, oid)) close();
  };

  let title = "";
  let body = null;
  let actions = null;
  if (current?.kind === "blame") {
    title = `Blame: ${current.path}${current.rev ? ` @ ${current.rev.slice(0, 7)}` : ""}`;
    body = (
      <BlameView
        key={`${current.path}@${current.rev}`}
        repoId={repoId}
        path={current.path}
        rev={current.rev}
        onReveal={(oid) => void reveal(oid)}
      />
    );
    actions = (
      <Button size="sm" onClick={() => openFileHistory(repoId, current.path)}>
        File history
      </Button>
    );
  } else if (current?.kind === "history") {
    title = `History: ${current.path}`;
    body = (
      <FileHistoryView
        key={current.path}
        repoId={repoId}
        path={current.path}
        onReveal={(oid) => void reveal(oid)}
        onBlame={(oid, path) => openBlame(repoId, path, oid)}
      />
    );
    actions = (
      <Button size="sm" onClick={() => openBlame(repoId, current.path, null)}>
        Blame
      </Button>
    );
  } else if (current?.kind === "reflog") {
    title = `Reflog: ${current.refName.replace(/^refs\/(heads|remotes)\//, "")}`;
    body = (
      <ReflogView
        key={current.refName}
        repoId={repoId}
        refName={current.refName}
        onReveal={(oid) => void reveal(oid)}
      />
    );
  }

  return (
    <>
      <Dialog open={current !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent
          hideClose={false}
          className="flex h-[80vh] w-[min(1200px,calc(100vw-32px))] max-w-none flex-col gap-0 p-0"
        >
          <div className="flex items-center gap-3 border-b border-border py-2 pl-3 pr-12">
            <DialogTitle className="min-w-0 flex-1 truncate font-mono text-base">
              {title}
            </DialogTitle>
            {actions}
          </div>
          <DialogDescription className="sr-only">
            Press Escape to close and return to the graph.
          </DialogDescription>
          <div className="min-h-0 flex-1">{body}</div>
        </DialogContent>
      </Dialog>
      <PathPromptDialog repoId={repoId} />
      <AddWorktreeDialog repoId={repoId} open={addWorktreeFor === repoId} onClose={closeAdd} />
    </>
  );
}
