import type { ScreenContribution } from "@/app/layout/registry";
import { FileHistoryPage, ReflogPage } from "@/features/history-views/MobilePages";
import { BranchesScreen } from "./BranchesScreen";
import { CommitFileScreen } from "./CommitFileScreen";
import { CommitScreen } from "./CommitScreen";
import { HistoryScreen } from "./HistoryScreen";

export const repoScreens: ScreenContribution = {
  tabs: { history: HistoryScreen, branches: BranchesScreen },
  routes: {
    commit: CommitScreen,
    commitFile: CommitFileScreen,
    fileHistory: FileHistoryPage,
    reflog: ReflogPage,
  },
};
