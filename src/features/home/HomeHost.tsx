import { FolderPlus, LayoutGrid } from "lucide-react";
import { useRegisterCommands, type Command } from "@/app/commands";
import { usePlatform } from "@/app/platform";
import { InitRepoDialog } from "./InitRepoDialog";
import { useHomeDialogs } from "./store";
import { WorkspaceDialog } from "./WorkspaceDialog";

/** Mounts the Create repository and workspace dialogs and their palette commands. */
export function HomeHost() {
  const { canPickFolder, readOnly } = usePlatform();
  const commands: Command[] = [
    ...(canPickFolder && !readOnly
      ? [
          {
            id: "repo.init",
            title: "Create repository",
            group: "Repository",
            icon: FolderPlus,
            keywords: ["init", "new"],
            run: () => useHomeDialogs.getState().openInit(),
          } satisfies Command,
        ]
      : []),
    {
      id: "workspace.new",
      title: "New workspace",
      group: "Repository",
      icon: LayoutGrid,
      keywords: ["group", "repositories"],
      run: () => useHomeDialogs.getState().openWorkspace({ mode: "create" }),
    },
  ];
  useRegisterCommands(commands, [canPickFolder, readOnly]);
  return (
    <>
      <InitRepoDialog />
      <WorkspaceDialog />
    </>
  );
}
