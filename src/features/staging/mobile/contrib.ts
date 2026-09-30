import type { ScreenContribution } from "@/app/layout/registry";
import { ConflictFileScreen } from "@/features/operations/conflicts/mobile/ConflictFileScreen";
import { ConflictsScreen } from "@/features/operations/conflicts/mobile/ConflictsScreen";
import { StashScreen } from "@/features/stash/StashScreen";
import { ChangesScreen } from "./ChangesScreen";
import { ComposerScreen } from "./ComposerScreen";
import { DiffScreen } from "./DiffScreen";

/** Phone screens for the Changes tab and its drill-downs. */
export const stagingScreens: ScreenContribution = {
  tabs: { changes: ChangesScreen },
  routes: {
    worktreeDiff: DiffScreen,
    compose: ComposerScreen,
    conflicts: ConflictsScreen,
    conflict: ConflictFileScreen,
    stash: StashScreen,
  },
};
