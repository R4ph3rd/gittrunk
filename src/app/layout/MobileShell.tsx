import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { CircleDot, FileDiff, GitBranch, GitCommitVertical, Menu } from "lucide-react";
import { AiHost, suggestConflictResolution } from "@/features/ai";
import { BottomNav, NavRail, type NavItem } from "@/design/components";
import { GraphView } from "@/features/graph/GraphView";
import { useWipCount } from "@/features/graph/useWipCount";
import { ConflictSuggestProvider } from "@/features/operations/conflicts/suggest";
import { OperationsProvider } from "@/features/operations/dnd/OperationsProvider";
import { OperationsHost } from "@/features/operations/OperationsHost";
import { forgeScreens } from "@/features/forge/mobile/contrib";
import { RemotesHost } from "@/features/remotes/RemotesHost";
import { RefsSidebar } from "@/features/repo/RefsSidebar";
import { repoScreens } from "@/features/repo/mobile/contrib";
import { Welcome } from "@/features/repo/Welcome";
import { SettingsHost } from "@/features/settings";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { StagingPanel } from "@/features/staging/StagingPanel";
import { stagingScreens } from "@/features/staging/mobile/contrib";
import { StashDialog } from "@/features/stash/StashDialog";
import { usePlatform } from "@/app/platform";
import { useAiEnabled, useRepoEvents } from "@/ipc/queries";
import { NO_REPO, useNav, useNavStore, type RouteName, type TabId } from "@/stores/nav";
import { useRepoStore } from "@/stores/repo";
import { useSettingsStore } from "@/stores/settings";
import { CommandHost } from "../commands";
import { MoreScreen } from "./MoreScreen";
import { NotAvailableScreen } from "./NotAvailableScreen";
import { ShellAppBar } from "./ShellAppBar";
import type {
  RouteScreenProps,
  RouteScreens,
  ScreenContribution,
  TabScreenProps,
} from "./registry";
import { useLayout } from "./useLayout";

const useNoBadges = (): Partial<Record<TabId, number | boolean>> => ({});

/** Dot on Changes while the working copy has uncommitted files. */
function useChangesBadge(repoId: string): Partial<Record<TabId, number | boolean>> {
  const { staged, unstaged } = useWipCount(repoId);
  return { changes: staged + unstaged > 0 };
}

/** Screens the shell itself provides: the More tab and the settings pages. */
const shellScreens: ScreenContribution = {
  tabs: { more: MoreScreen },
  routes: { settings: SettingsPage },
  useTabBadges: useChangesBadge,
};

const useRepoBadges = repoScreens.useTabBadges ?? useNoBadges;
const useStagingBadges = stagingScreens.useTabBadges ?? useNoBadges;
const useShellBadges = shellScreens.useTabBadges ?? useNoBadges;
const useForgeBadges = forgeScreens.useTabBadges ?? useNoBadges;

const CONTRIBUTIONS = [repoScreens, stagingScreens, forgeScreens, shellScreens];
const TAB_SCREENS: Partial<Record<TabId, ComponentType<TabScreenProps>>> = Object.assign(
  {},
  ...CONTRIBUTIONS.map((c) => c.tabs ?? {}),
);
const ROUTE_SCREENS: RouteScreens = Object.assign({}, ...CONTRIBUTIONS.map((c) => c.routes ?? {}));

/** History without a contributed screen: the desktop graph; a tapped commit opens its page. */
function HistoryFallback({ repoId }: TabScreenProps) {
  const selection = useRepoStore((s) => s.selection[repoId]);
  const seen = useRef(selection);
  useEffect(() => {
    if (selection === seen.current) return;
    seen.current = selection;
    const nav = useNavStore.getState();
    if (selection?.kind === "commit") nav.push(repoId, { name: "commit", oid: selection.oid });
    else if (selection?.kind === "wip") nav.setTab(repoId, "changes");
  }, [selection, repoId]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar repoId={repoId} />
      <div data-scroll-root="" className="min-h-0 flex-1">
        <GraphView repoId={repoId} />
      </div>
    </div>
  );
}

function ChangesFallback({ repoId }: TabScreenProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar repoId={repoId} />
      <div className="min-h-0 flex-1">
        <StagingPanel repoId={repoId} />
      </div>
    </div>
  );
}

function BranchesFallback({ repoId }: TabScreenProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar repoId={repoId} />
      <div className="min-h-0 flex-1">
        <RefsSidebar repoId={repoId} />
      </div>
    </div>
  );
}

/** Shown when no forge screen is contributed. */
function IssuesFallback({ repoId }: TabScreenProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellAppBar repoId={repoId} />
    </div>
  );
}

const FALLBACK_TABS: Record<TabId, ComponentType<TabScreenProps>> = {
  history: HistoryFallback,
  changes: ChangesFallback,
  branches: BranchesFallback,
  issues: IssuesFallback,
  more: MoreScreen,
};

const NAV_ITEMS: { id: TabId; label: string; icon: NavItem["icon"] }[] = [
  { id: "history", label: "History", icon: <GitCommitVertical /> },
  { id: "changes", label: "Changes", icon: <FileDiff /> },
  { id: "branches", label: "Branches", icon: <GitBranch /> },
  { id: "issues", label: "Issues", icon: <CircleDot /> },
  { id: "more", label: "More", icon: <Menu /> },
];

/** Routes that need write access; read-only platforms show "not available" instead. */
const WRITE_ROUTES: ReadonlySet<RouteName> = new Set<RouteName>([
  "compose",
  "worktreeDiff",
  "conflicts",
  "conflict",
  "stash",
]);

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range", "file"].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

/** True while a text field has focus (the soft keyboard is probably open). */
function useTextFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const update = () => setFocused(isTextInput(document.activeElement));
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return focused;
}

/** Scrolls the screen's declared scroll root (`data-scroll-root`), else its first scroller. */
function scrollRootToTop(main: HTMLElement | null) {
  if (!main) return;
  const root = main.querySelector<HTMLElement>("[data-scroll-root]") ?? main;
  const scroller = isScroller(root)
    ? root
    : Array.from(root.querySelectorAll<HTMLElement>("*")).find(isScroller);
  scroller?.scrollTo?.({ top: 0 });
}

function isScroller(el: HTMLElement): boolean {
  const oy = getComputedStyle(el).overflowY;
  return oy === "auto" || oy === "scroll";
}

function RouteScreen({ repoId }: { repoId: string }) {
  const nav = useNav();
  const { readOnly } = usePlatform();
  const route = nav.top;
  if (!route) return null;
  if (readOnly && WRITE_ROUTES.has(route.name)) {
    return <NotAvailableScreen repoId={repoId} name={route.name} />;
  }
  const Screen = ROUTE_SCREENS[route.name] as
    ComponentType<RouteScreenProps<RouteName>> | undefined;
  if (!Screen) return <NotAvailableScreen repoId={repoId} name={route.name} />;
  return <Screen repoId={repoId} route={route} />;
}

/** One open repository: tab or route screen plus the navigation chrome and per-repo hosts. */
function RepoShell({ repoId }: { repoId: string }) {
  const { isShort } = useLayout();
  const nav = useNav();
  const { readOnly } = usePlatform();
  const mainRef = useRef<HTMLElement>(null);
  const typing = useTextFocused();
  useRepoEvents(repoId);

  const aiEnabled = useAiEnabled();
  const suggest = useMemo(
    () =>
      aiEnabled
        ? (file: { path: string }) => suggestConflictResolution(repoId, file.path)
        : undefined,
    [aiEnabled, repoId],
  );

  const badges = {
    ...useShellBadges(repoId),
    ...useStagingBadges(repoId),
    ...useForgeBadges(repoId),
    ...useRepoBadges(repoId),
  };
  const items: NavItem[] = NAV_ITEMS.filter((i) => !(readOnly && i.id === "changes")).map((i) => ({
    ...i,
    badge: badges[i.id],
  }));

  const onSelect = (id: string) => {
    const tab = id as TabId;
    if (tab !== nav.tab) {
      nav.setTab(tab);
      return;
    }
    if (nav.stack.length > 0) nav.resetTab();
    requestAnimationFrame(() => scrollRootToTop(mainRef.current));
  };

  // Read-only platforms have no Changes tab: a stored "changes" tab shows History.
  const tab: TabId = readOnly && nav.tab === "changes" ? "history" : nav.tab;
  const TabScreen = TAB_SCREENS[tab] ?? FALLBACK_TABS[tab];
  const Nav = isShort ? NavRail : BottomNav;

  return (
    <ConflictSuggestProvider value={suggest}>
      <OperationsProvider>
        <div className={isShort ? "flex min-h-0 flex-1 flex-row" : "flex min-h-0 flex-1 flex-col"}>
          {isShort ? (
            <Nav items={items} activeId={tab} onSelect={onSelect} hidden={typing} />
          ) : null}
          <main ref={mainRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
            {nav.top ? <RouteScreen repoId={repoId} /> : <TabScreen repoId={repoId} />}
          </main>
          {isShort ? null : (
            <Nav items={items} activeId={tab} onSelect={onSelect} hidden={typing} />
          )}
        </div>
        <StashDialog repoId={repoId} />
        <OperationsHost repoId={repoId} />
      </OperationsProvider>
    </ConflictSuggestProvider>
  );
}

/** Phone / small-tablet shell: one screen at a time, bottom navigation, drill-down stack. */
export function MobileShell() {
  const activeId = useRepoStore((s) => s.activeId);
  const top = useNav().top;

  // The settings dialog (palette, shortcut) becomes the settings route on compact layouts.
  const settingsOpen = useSettingsStore((s) => s.open);
  useEffect(() => {
    if (!settingsOpen) return;
    useSettingsStore.getState().closeDialog();
    const repoId = useRepoStore.getState().activeId ?? NO_REPO;
    const nav = useNavStore.getState();
    const cur = nav.byRepo[repoId]?.stack.at(-1);
    if (cur?.name !== "settings") nav.push(repoId, { name: "settings" });
  }, [settingsOpen]);

  return (
    <div className="flex h-full flex-col bg-chrome">
      {activeId ? (
        <RepoShell key={activeId} repoId={activeId} />
      ) : top?.name === "settings" ? (
        <SettingsPage repoId={NO_REPO} route={top} />
      ) : (
        <Welcome />
      )}
      <CommandHost />
      <RemotesHost />
      <SettingsHost />
      <AiHost />
    </div>
  );
}
