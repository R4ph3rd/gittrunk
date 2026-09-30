/** `/design` "Mobile" section: every touch-first component in both themes in a device frame. */
import { GitBranch, GitCommit, History, MoreHorizontal, Search, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { LayoutProvider } from "@/app/layout/LayoutProvider";
import {
  ActionSheet,
  AppBar,
  BottomNav,
  Button,
  Checkbox,
  CommandPalette,
  IconButton,
  Input,
  ListRow,
  NavRail,
  PullToRefresh,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  SegmentedControl,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SwipeRow,
  Switch,
  toast,
} from "./components";
import { useKeyboardInset } from "./hooks";

const mobileTokens = [
  ["--touch-target", "44px"],
  ["--touch-target-row", "52px"],
  ["--appbar-h", "48px"],
  ["--appbar-h-short", "40px"],
  ["--bottomnav-h", "56px"],
  ["--navrail-w", "72px"],
  ["--sheet-radius", "--radius-lg"],
  ["--sheet-handle", "32px"],
  ["--sheet-handle-h", "4px"],
  ["--sheet-max-h", "85dvh"],
  ["--sheet-duration", "--duration-base"],
  ["--swipe-duration", "150ms"],
  ["--progress-h", "2px"],
  ["--safe-top/bottom/left/right", "env(safe-area-inset-*)"],
  ["--kb-inset", "written by useKeyboardInset()"],
];

const navItems = [
  { id: "history", label: "History", icon: <History /> },
  { id: "changes", label: "Changes", icon: <GitCommit />, badge: 3 },
  { id: "branches", label: "Branches", icon: <GitBranch />, badge: true },
  { id: "more", label: "More", icon: <MoreHorizontal /> },
];

function Frame({ theme }: { theme: "dark" | "light" }) {
  const [tab, setTab] = useState("history");
  const [sheet, setSheet] = useState(false);
  const [fullSheet, setFullSheet] = useState(false);
  const [actions, setActions] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [palette, setPalette] = useState(false);
  const [refreshes, setRefreshes] = useState(0);
  const [seg, setSeg] = useState("unified");
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);

  return (
    <LayoutProvider force={{ isCompact: true, isCoarse: true }}>
      <div className="flex flex-col gap-2">
        <code className="font-mono text-xs text-fg-muted">{theme} 390x844</code>
        <div
          data-theme={theme}
          className="relative flex h-[844px] w-[390px] flex-col overflow-hidden rounded-lg border border-border-strong bg-bg text-fg shadow-lg"
        >
          <AppBar
            title="gittrunk"
            subtitle="main"
            onTitleClick={() => toast("Repo switcher")}
            onBack={() => toast("Back")}
            actions={
              <IconButton aria-label="Search actions" onClick={() => setPalette(true)}>
                <Search />
              </IconButton>
            }
            progress={0.6}
          />
          <PullToRefresh
            className="flex-1"
            onRefresh={() =>
              new Promise((r) => setTimeout(r, 800)).then(() => setRefreshes((n) => n + 1))
            }
          >
            <div className="flex flex-col divide-y divide-border">
              <ListRow
                title="Refreshed"
                subtitle={`${refreshes} times (pull down to refresh)`}
                leading={<History />}
              />
              <SwipeRow
                leftAction={{
                  label: "Stage",
                  icon: <GitCommit />,
                  tone: "success",
                  onTrigger: () => toast.success("Staged"),
                }}
                rightAction={{
                  label: "Discard",
                  icon: <Trash2 />,
                  tone: "danger",
                  onTrigger: () => toast.error("Discarded"),
                }}
              >
                <ListRow
                  title="src/design/tokens.css"
                  subtitle="Swipe right to stage, left to discard"
                  trailing={<Checkbox aria-label="Select tokens.css" />}
                  onClick={() => setActions(true)}
                />
              </SwipeRow>
              <ListRow
                title="Selected row"
                subtitle="selected"
                selected
                chevron
                onClick={() => {}}
              />
              <ListRow title="Disabled row" disabled onClick={() => {}} />
              <ListRow
                title="A very long title that has to truncate instead of wrapping to a second line"
                subtitle="and a subtitle that is also far too long to fit on a single 390 wide line"
                trailing={<span className="font-mono text-xs text-fg-subtle">a1b2c3d</span>}
              />
              <div className="flex flex-col gap-3 p-3">
                <Input placeholder="Commit message" aria-label="Commit message" />
                <div className="flex items-center gap-3">
                  <Switch aria-label="Amend" checked={on} onCheckedChange={setOn} />
                  <Checkbox label="Sign off" checked={checked} onCheckedChange={setChecked} />
                </div>
                <SegmentedControl
                  aria-label="Diff mode"
                  value={seg}
                  onValueChange={setSeg}
                  options={[
                    { value: "unified", label: "Unified" },
                    { value: "split", label: "Split" },
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary">Primary</Button>
                  <Button>Secondary</Button>
                  <Button variant="danger">Danger</Button>
                  <IconButton aria-label="Undo">
                    <Undo2 />
                  </IconButton>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setSheet(true)}>Sheet (auto)</Button>
                  <Button onClick={() => setFullSheet(true)}>Sheet (full)</Button>
                  <Button onClick={() => setActions(true)}>ActionSheet</Button>
                  <Button onClick={() => setDialog(true)}>ResponsiveDialog</Button>
                  <Button onClick={() => setPalette(true)}>Palette</Button>
                </div>
              </div>
            </div>
          </PullToRefresh>
          <BottomNav items={navItems} activeId={tab} onSelect={setTab} />
        </div>
      </div>

      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Sheet</SheetTitle>
            <SheetDescription>Auto height, drag the handle down to dismiss.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4 text-base text-fg-muted">Content</div>
          <SheetFooter>
            <Button variant="primary" onClick={() => setSheet(false)}>
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <Sheet open={fullSheet} onOpenChange={setFullSheet}>
        <SheetContent snap="full">
          <SheetHeader>
            <SheetTitle>Full sheet</SheetTitle>
            <SheetDescription>100dvh minus the top safe area.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
      <ActionSheet
        open={actions}
        onOpenChange={setActions}
        title="src/design/tokens.css"
        description="Choose an action"
        items={[]}
        groups={[
          [
            {
              id: "stage",
              label: "Stage file",
              icon: <GitCommit />,
              onSelect: () => toast("Stage"),
            },
            {
              id: "hist",
              label: "File history",
              description: "Commits touching this file",
              icon: <History />,
              onSelect: () => toast("History"),
            },
            { id: "off", label: "Unavailable", disabled: true, onSelect: () => {} },
          ],
          [
            {
              id: "discard",
              label: "Discard changes",
              icon: <Trash2 />,
              destructive: true,
              onSelect: () => toast.error("Discarded"),
            },
          ],
        ]}
      />
      <ResponsiveDialog open={dialog} onOpenChange={setDialog}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Clone repository</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              A Dialog on regular layouts, a full Sheet on compact.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="px-4">
            <Input placeholder="https://..." aria-label="URL" autoCapitalize="none" />
          </div>
          <ResponsiveDialogFooter>
            <Button variant="primary" onClick={() => setDialog(false)}>
              Clone
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        groups={[
          {
            heading: "Actions",
            items: [
              { id: "fetch", label: "Fetch", shortcut: "Ctrl+F", onSelect: () => toast("Fetch") },
              { id: "pull", label: "Pull", shortcut: "Ctrl+P", onSelect: () => toast("Pull") },
            ],
          },
        ]}
      />
    </LayoutProvider>
  );
}

function RailFrame() {
  const [tab, setTab] = useState("changes");
  return (
    <div className="flex flex-col gap-2">
      <code className="font-mono text-xs text-fg-muted">NavRail + short AppBar (landscape)</code>
      <div className="flex h-72 w-[640px] max-w-full overflow-hidden rounded-lg border border-border-strong bg-bg">
        <NavRail items={navItems} activeId={tab} onSelect={setTab} />
        <div className="flex-1">
          <AppBar title="Landscape" subtitle="main" progress="indeterminate" />
        </div>
      </div>
    </div>
  );
}

function KeyboardInsetProbe() {
  const inset = useKeyboardInset();
  return <code className="font-mono text-xs text-fg-muted">useKeyboardInset(): {inset}px</code>;
}

export function MobileSection() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-b border-border pb-2 text-lg font-semibold">Mobile</h2>
      <p className="text-base text-fg-muted">
        Components render inside <code className="font-mono">LayoutProvider</code> forced to compact
        and coarse. CSS <code className="font-mono">coarse:</code> sizing follows the real pointer,
        so enable device emulation to see 44px targets. Sheets open over the page.
      </p>
      <div className="flex flex-wrap gap-2">
        {mobileTokens.map(([name, value]) => (
          <span
            key={name}
            className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-fg-muted"
          >
            {name}: {value}
          </span>
        ))}
      </div>
      <KeyboardInsetProbe />
      <div className="flex flex-wrap gap-6">
        <Frame theme="dark" />
        <Frame theme="light" />
      </div>
      <RailFrame />
    </section>
  );
}
