/* Dev-only: mocks the Tauri IPC layer so the real UI renders in a plain browser. */
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { THEME_STORAGE_KEY } from "@/design/theme";
import { useLayoutStore, type PanelId } from "@/stores/layout";
import { useRepoStore } from "@/stores/repo";
import {
  openCommitDiff,
  openIssue,
  openIssues,
  openNewIssue,
  openWorktreeDiff,
  useWorkspaceStore,
} from "@/stores/workspace";
import { configureHandlers, handleCommand } from "./handlers";
import { GRAPH_ROWS, commitFiles, fixtureRepoInfo, makeStatus } from "./fixtures";

const PANELS: PanelId[] = ["sidebar", "bottom", "right"];

function safeStorage(fn: (s: Storage) => void) {
  try {
    fn(window.localStorage);
  } catch {
    /* storage unavailable */
  }
}

/** Open a center view / selection once the repo tab exists. */
function applyWorkspace(params: URLSearchParams, conflict: boolean) {
  const id = fixtureRepoInfo.id;
  const repo = useRepoStore.getState();
  const row = Number.parseInt(params.get("select") ?? "", 10);
  const selected = GRAPH_ROWS[Number.isNaN(row) ? 0 : row] ?? GRAPH_ROWS[0];
  if (!selected) return;
  if (!Number.isNaN(row)) repo.selectCommit(id, selected.oid);
  const right = params.get("right");
  if (right === "commit" || right === "changes") {
    useWorkspaceStore.getState().setRightTab(id, right);
    if (right === "changes") repo.selectWip(id);
  }
  switch (params.get("center")) {
    case "diff": {
      const file = commitFiles(selected.oid)[0];
      if (file) openCommitDiff(id, selected.oid, file.path);
      break;
    }
    case "worktree": {
      const status = makeStatus(conflict);
      const file = status.unstaged[0];
      if (file) openWorktreeDiff(id, file.path, false);
      break;
    }
    case "issues":
      openIssues(id);
      break;
    case "issue":
      openIssue(id, 12);
      break;
    case "new":
      openNewIssue(id);
      break;
    default:
  }
}

export function installPreview(params: URLSearchParams): void {
  const platform = params.get("platform") === "android" ? "android" : "desktop";
  const themeParam = params.get("theme");
  const theme = themeParam === "light" ? "light" : "dark";
  const conflict = params.get("conflict") === "1";

  mockWindows("main");
  configureHandlers({
    platform,
    theme,
    conflict,
    emit: (event, payload) => void emit(event, payload),
  });
  mockIPC((cmd, payload) => handleCommand(cmd, payload), { shouldMockEvents: true });

  safeStorage((s) => s.setItem(THEME_STORAGE_KEY, theme));
  if (params.get("tree") === "1") safeStorage((s) => s.setItem("gittrunk.fileListMode", "tree"));

  // Stores are created when the app module graph loads (before this runs), so use their setters.
  const panels = params.get("panels");
  if (panels !== null) {
    const wanted = new Set(panels.split(",").map((p) => p.trim()));
    for (const p of PANELS) useLayoutStore.getState().setVisible(p, wanted.has(p));
  }

  if (params.get("repo") === "0") return;
  // After the first render: the fixture repo opens like a repo picked by the user.
  setTimeout(() => {
    useRepoStore.getState().addRepo(fixtureRepoInfo);
    applyWorkspace(params, conflict);
  }, 0);
}
