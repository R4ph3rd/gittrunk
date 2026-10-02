import type { ScreenContribution } from "@/app/layout/registry";
import { PullScreen } from "./pullScreens";
import { IssueScreen, IssuesScreen, NewIssueScreen } from "./screens";

/** Mobile forge screens: the Issues tab and the issue and new-issue routes. */
export const forgeScreens: ScreenContribution = {
  tabs: { issues: IssuesScreen },
  routes: { issue: IssueScreen, newIssue: NewIssueScreen, pull: PullScreen },
};
