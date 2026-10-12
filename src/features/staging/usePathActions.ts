import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "@/design/components";
import { commands, type IgnoreTarget } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { useIgnoreAdd, useUntrackPaths } from "@/ipc/queries";
import { openSettings } from "@/stores/settings";
import { errorMessage, useOutcomeToast } from "./ops";
import { patchFileName } from "./pathActions";

/** Path-level actions of the Changes panel context menu, each reporting its own result. */
export function usePathActions(repoId: string) {
  const ignoreAdd = useIgnoreAdd(repoId);
  const untrack = useUntrackPaths(repoId);
  const notify = useOutcomeToast(repoId);

  /** Appends `patterns` to .gitignore (or .git/info/exclude); offers `git rm --cached` for tracked matches. */
  const ignore = async (patterns: string[], target: IgnoreTarget) => {
    try {
      const result = await ignoreAdd.mutateAsync({ patterns, target, dryRun: false });
      if (result.added.length === 0) {
        toast.info(`Already in ${result.file}: ${result.alreadyPresent.join(", ")}`);
        return;
      }
      const message = `Added ${result.added.join(", ")} to ${result.file}`;
      const tracked = result.tracked;
      if (tracked.length === 0) {
        toast.success(message);
        return;
      }
      toast.warning(message, {
        description: `${tracked.length} matching file${tracked.length === 1 ? " is" : "s are"} already tracked, so ignoring has no effect on ${tracked.length === 1 ? "it" : "them"} until you stop tracking.`,
        action: {
          label: "Also stop tracking",
          onClick: () => {
            untrack.mutateAsync({ paths: tracked, dryRun: false }).then(
              (outcome) => notify(outcome, "Stopped tracking"),
              (e: unknown) => toast.error(`Could not stop tracking: ${errorMessage(e)}`),
            );
          },
        },
      });
    } catch (e) {
      toast.error(
        `Could not update ${target === "exclude" ? "the exclude file" : ".gitignore"}: ${errorMessage(e)}`,
      );
    }
  };

  const openDiffTool = async (path: string, staged: boolean) => {
    try {
      await unwrap(commands.difftoolOpen(repoId, path, staged));
    } catch (e) {
      toast.error("Could not open the diff tool", {
        description: errorMessage(e),
        action: { label: "Git settings", onClick: () => openSettings("git") },
      });
    }
  };

  const createPatch = async (paths: string[], staged: boolean) => {
    try {
      const dest = await save({
        defaultPath: patchFileName(paths),
        filters: [{ name: "Patch", extensions: ["patch", "diff"] }],
      });
      if (!dest) return;
      await unwrap(commands.diffPatchSave(repoId, paths, staged, dest));
      toast.success(`Patch saved to ${dest}`);
    } catch (e) {
      toast.error(`Could not create the patch: ${errorMessage(e)}`);
    }
  };

  const copyPatch = async (paths: string[], staged: boolean) => {
    try {
      const patch = await unwrap(commands.diffPatch(repoId, paths, staged));
      if (!patch) {
        toast.info("There are no changes to copy");
        return;
      }
      await navigator.clipboard.writeText(patch);
      toast.success("Patch copied to the clipboard");
    } catch (e) {
      toast.error(`Could not copy the patch: ${errorMessage(e)}`);
    }
  };

  return { ignore, openDiffTool, createPatch, copyPatch };
}
