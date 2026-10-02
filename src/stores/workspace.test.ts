import { beforeEach, describe, expect, it } from "vitest";
import {
  openCommitDiff,
  openIssue,
  openIssues,
  openPull,
  openPulls,
  openWorktreeDiff,
  showGraph,
  useWorkspaceStore,
} from "./workspace";

const stack = (id = "r1") => useWorkspaceStore.getState().stacks[id] ?? [];

describe("workspace store", () => {
  beforeEach(() => useWorkspaceStore.getState().reset());

  it("defaults the right tab to commit", () => {
    expect(useWorkspaceStore.getState().rightTab["r1"]).toBeUndefined();
    useWorkspaceStore.getState().setRightTab("r1", "changes");
    expect(useWorkspaceStore.getState().rightTab["r1"]).toBe("changes");
  });

  it("pushes views and pops with back", () => {
    openIssues("r1");
    openIssue("r1", 4);
    expect(stack()).toEqual([{ kind: "issues" }, { kind: "issue", number: 4 }]);
    useWorkspaceStore.getState().back("r1");
    expect(stack()).toEqual([{ kind: "issues" }]);
    useWorkspaceStore.getState().back("r1");
    useWorkspaceStore.getState().back("r1");
    expect(stack()).toEqual([]);
  });

  it("replaces a diff on top with another diff", () => {
    openIssues("r1");
    openCommitDiff("r1", "abc", "a.txt");
    openCommitDiff("r1", "abc", "b.txt");
    openWorktreeDiff("r1", "c.txt", true);
    expect(stack()).toEqual([
      { kind: "issues" },
      { kind: "worktreeDiff", path: "c.txt", staged: true },
    ]);
  });

  it("ignores a view equal to the top", () => {
    openIssue("r1", 1);
    openIssue("r1", 1);
    expect(stack()).toHaveLength(1);
  });

  it("opens the pull request list and a pull request", () => {
    openPulls("r1");
    openPull("r1", 7);
    expect(stack()).toEqual([{ kind: "pulls" }, { kind: "pull", number: 7 }]);
    openPull("r1", 7);
    expect(stack()).toHaveLength(2);
    openPull("r1", 8);
    expect(stack()[2]).toEqual({ kind: "pull", number: 8 });
  });

  it("caps the stack at 20", () => {
    for (let i = 0; i < 30; i++) openIssue("r1", i);
    expect(stack()).toHaveLength(20);
    expect(stack()[19]).toEqual({ kind: "issue", number: 29 });
    expect(stack()[0]).toEqual({ kind: "issue", number: 10 });
  });

  it("showGraph clears the stack", () => {
    openIssues("r1");
    showGraph("r1");
    expect(stack()).toEqual([]);
  });

  it("keeps repos apart and forgets one", () => {
    openIssues("r1");
    openIssues("r2");
    useWorkspaceStore.getState().setRightTab("r1", "changes");
    useWorkspaceStore.getState().forget("r1");
    expect(stack("r1")).toEqual([]);
    expect(useWorkspaceStore.getState().rightTab["r1"]).toBeUndefined();
    expect(stack("r2")).toHaveLength(1);
  });
});
