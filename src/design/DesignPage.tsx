/** Dev-only `/design` route: every token and component, in both themes. */
import { Copy, GitBranch, GitCommit, Inbox, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  Badge,
  Button,
  CommandPalette,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  SegmentedControl,
  Checkbox,
  Input,
  Kbd,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  Separator,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  Toaster,
  Tooltip,
  TooltipProvider,
} from "./components";
import { ThemeProvider, useTheme, type Theme } from "./theme";

const colorGroups: Record<string, string[]> = {
  Surfaces: ["bg", "bg-subtle", "surface", "surface-raised", "surface-hover"],
  Borders: ["border", "border-strong"],
  Text: ["fg", "fg-muted", "fg-subtle"],
  Accent: ["accent", "accent-fg", "accent-muted", "focus-ring"],
  Status: ["danger", "danger-fg", "success", "warning", "diff-add-bg", "diff-del-bg"],
  Overlay: ["overlay", "selection", "scrollbar-thumb", "scrollbar-thumb-hover"],
  Primitives: [
    "indigo-950",
    "indigo-900",
    "indigo-700",
    "teal-900",
    "teal-500",
    "teal-400",
    "amber-400",
    "rose-500",
    "green-500",
  ],
};
const typeScale = ["xs", "sm", "base", "lg", "xl", "2xl"];
const spaces = ["1", "2", "3", "4", "6", "8"];
const radii = ["sm", "md", "lg"];
const shadows = ["sm", "md", "lg"];
const zIndexes = ["base", "sticky", "dropdown", "overlay", "modal", "popover", "toast", "tooltip"];
const lanes = [0, 1, 2, 3, 4, 5, 6, 7];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-b border-border pb-2 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label ? <span className="w-24 shrink-0 text-sm text-fg-subtle">{label}</span> : null}
      {children}
    </div>
  );
}

function Swatch({ name }: { name: string }) {
  return (
    <div className="flex w-40 flex-col gap-1">
      <div
        className="h-10 rounded-md border border-border"
        style={{ background: `var(--${name})` }}
      />
      <code className="font-mono text-xs text-fg-muted">--{name}</code>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div role="group" aria-label="Theme" className="flex gap-1">
      {(["dark", "light", "system"] as Theme[]).map((t) => (
        <Button
          key={t}
          size="sm"
          variant={theme === t ? "primary" : "secondary"}
          aria-pressed={theme === t}
          onClick={() => setTheme(t)}
        >
          {t}
        </Button>
      ))}
    </div>
  );
}

function Components() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [seg, setSeg] = useState("list");

  return (
    <>
      <Section title="Button">
        {(["primary", "secondary", "ghost", "danger", "outline"] as const).map((variant) => (
          <Row key={variant} label={variant}>
            <Button variant={variant} size="md">
              Button
            </Button>
            <Button variant={variant} size="sm">
              Small
            </Button>
            <Button variant={variant} size="md">
              <Plus /> With icon
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} loading>
              Loading
            </Button>
          </Row>
        ))}
        <Row label="IconButton">
          <IconButton aria-label="Refresh">
            <RefreshCw />
          </IconButton>
          <IconButton aria-label="Add" variant="secondary">
            <Plus />
          </IconButton>
          <IconButton aria-label="Delete" variant="danger">
            <Trash2 />
          </IconButton>
          <IconButton aria-label="Disabled" disabled>
            <Copy />
          </IconButton>
        </Row>
        <Row label="IconButton sizes (xs / sm / md)">
          {(["xs", "sm", "md"] as const).map((size) => (
            <IconButton key={size} size={size} aria-label={`Refresh ${size}`}>
              <RefreshCw />
            </IconButton>
          ))}
        </Row>
        <Row label="Button xs">
          <Button size="xs">Extra small</Button>
        </Row>
      </Section>

      <Section title="Inputs">
        <div className="grid max-w-md gap-3">
          <div className="grid gap-1">
            <Label htmlFor="d-input">Branch name</Label>
            <Input id="d-input" placeholder="feature/my-branch" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="d-invalid">Invalid</Label>
            <Input id="d-invalid" aria-invalid="true" defaultValue="bad name" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="d-disabled">Disabled</Label>
            <Input id="d-disabled" disabled defaultValue="locked" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="d-ta">Commit message</Label>
            <Textarea id="d-ta" placeholder="Describe the change" />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="d-sw" checked={on} onCheckedChange={setOn} />
            <Label htmlFor="d-sw">Auto fetch</Label>
            <Switch aria-label="Disabled switch" disabled />
          </div>
        </div>
      </Section>

      <Section title="Checkbox, SegmentedControl">
        <Row label="Checkbox">
          <Checkbox label="Checked" checked={checked} onCheckedChange={setChecked} />
          <Checkbox label="Unchecked" checked={false} />
          <Checkbox label="Indeterminate" checked="indeterminate" />
          <Checkbox label="Disabled" disabled />
          <Checkbox aria-label="No label" />
        </Row>
        <Row label="SegmentedControl md / sm">
          {(["md", "sm"] as const).map((size) => (
            <SegmentedControl
              key={size}
              size={size}
              aria-label={`View ${size}`}
              value={seg}
              onValueChange={setSeg}
              options={[
                { value: "list", label: "List", icon: <GitCommit /> },
                { value: "tree", label: "Tree", icon: <GitBranch /> },
                { value: "off", label: "Off", disabled: true },
              ]}
            />
          ))}
        </Row>
      </Section>

      <Section title="Badge, Kbd, Spinner">
        <Row label="Badge">
          <Badge>neutral</Badge>
          <Badge variant="accent">accent</Badge>
          <Badge variant="success">success</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="danger">danger</Badge>
        </Row>
        <Row label="Kbd">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </Row>
        <Row label="Spinner">
          <Spinner />
        </Row>
      </Section>

      <Section title="Overlays">
        <Row label="Tooltip">
          <Tooltip content="Fetch remotes" shortcut="Ctrl+F">
            <Button variant="secondary">Hover me</Button>
          </Tooltip>
        </Row>
        <Row label="Tooltip (no provider needed)">
          <Tooltip content="Works standalone">
            <IconButton aria-label="Info">
              <Inbox />
            </IconButton>
          </Tooltip>
        </Row>
        <Row label="Popover">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary">Open popover</Button>
            </PopoverTrigger>
            <PopoverContent>Popover content lives on a raised surface.</PopoverContent>
          </Popover>
        </Row>
        <Row label="Dialog">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New branch</DialogTitle>
                <DialogDescription>Create a branch from the current commit.</DialogDescription>
              </DialogHeader>
              <Input aria-label="Branch name" placeholder="feature/..." />
              <DialogFooter>
                <Button variant="primary">Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Row>
        <Row label="AlertDialog">
          <Button variant="danger" onClick={() => setAlertOpen(true)}>
            Delete branch
          </Button>
          <AlertDialog
            open={alertOpen}
            onOpenChange={setAlertOpen}
            title="Delete branch?"
            description="This permanently removes the branch."
            preview={<div>feature/design-system</div>}
            confirmLabel="Delete"
            onConfirm={() => toast.success("Branch deleted")}
          />
        </Row>
        <Row label="DropdownMenu">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Actions</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Branch</DropdownMenuLabel>
              <DropdownMenuItem icon={<GitBranch />} shortcut="Ctrl+B">
                Checkout
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Copy />}>Copy name</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Trash2 />} destructive>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>
        <Row label="ContextMenu">
          <ContextMenu>
            <ContextMenuTrigger className="flex h-16 w-64 items-center justify-center rounded-md border border-dashed border-border-strong text-sm text-fg-muted">
              Right-click here
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem icon={<GitCommit />}>Cherry-pick</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem icon={<Trash2 />} destructive>
                Drop commit
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </Row>
        <Row label="CommandPalette">
          <Button variant="secondary" onClick={() => setPaletteOpen(true)}>
            Open palette <Kbd>Ctrl+K</Kbd>
          </Button>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            groups={[
              {
                heading: "Git",
                items: [
                  {
                    id: "fetch",
                    label: "Fetch all remotes",
                    icon: <RefreshCw />,
                    shortcut: "Ctrl+F",
                    onSelect: () => toast("Fetching"),
                  },
                  {
                    id: "commit",
                    label: "Commit staged changes",
                    icon: <GitCommit />,
                    onSelect: () => toast("Committed"),
                  },
                ],
              },
            ]}
          />
        </Row>
        <Row label="Toast">
          <Button variant="secondary" onClick={() => toast("Default toast")}>
            Default
          </Button>
          <Button variant="secondary" onClick={() => toast.success("Saved")}>
            Success
          </Button>
          <Button variant="secondary" onClick={() => toast.error("Something failed")}>
            Error
          </Button>
        </Row>
      </Section>

      <Section title="Layout">
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">Changes</TabsTrigger>
            <TabsTrigger value="b">History</TabsTrigger>
            <TabsTrigger value="c" disabled>
              Disabled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="a">Changes tab content.</TabsContent>
          <TabsContent value="b">History tab content.</TabsContent>
        </Tabs>
        <Row label="Separator">
          <Separator className="max-w-xs" />
          <div className="flex h-6 items-center gap-2">
            a <Separator orientation="vertical" /> b
          </div>
        </Row>
        <Row label="ScrollArea">
          <ScrollArea className="h-24 w-64 rounded-md border border-border">
            <div className="p-2 text-base">
              {Array.from({ length: 20 }, (_, i) => (
                <div key={i} className="font-mono text-sm text-fg-muted">
                  commit {i.toString(16).padStart(7, "a")}
                </div>
              ))}
            </div>
          </ScrollArea>
        </Row>
        <Row label="Resizable">
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-24 w-full max-w-xl rounded-md border border-border"
          >
            <ResizablePanel defaultSize={30} minSize={15}>
              <div className="p-2 text-sm text-fg-muted">Sidebar</div>
            </ResizablePanel>
            <ResizableHandle aria-label="Resize sidebar" />
            <ResizablePanel defaultSize={70}>
              <div className="p-2 text-sm text-fg-muted">Main</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </Row>
        <EmptyState
          icon={<Inbox />}
          title="No repository open"
          description="Open a local repository to see its history."
          action={<Button variant="primary">Open repository</Button>}
        />
      </Section>
    </>
  );
}

function Page() {
  return (
    <div className="min-h-full overflow-auto bg-bg text-fg">
      <header className="sticky top-0 z-[var(--z-sticky)] flex items-center justify-between border-b border-border bg-chrome px-6 py-3">
        <h1 className="text-xl font-semibold tracking-tight">Design system</h1>
        <ThemeToggle />
      </header>
      <main className="mx-auto flex max-w-4xl flex-col gap-10 p-6">
        <Section title="Colors">
          {Object.entries(colorGroups).map(([group, names]) => (
            <div key={group} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-fg-muted">{group}</h3>
              <div className="flex flex-wrap gap-3">
                {names.map((n) => (
                  <Swatch key={n} name={n} />
                ))}
              </div>
            </div>
          ))}
        </Section>

        <Section title="Graph lane colors">
          <div className="flex flex-wrap gap-3">
            {lanes.map((i) => (
              <Swatch key={i} name={`lane-${i}`} />
            ))}
          </div>
        </Section>

        <Section title="Typography">
          {typeScale.map((s) => (
            <div key={s} className="flex items-baseline gap-4">
              <code className="w-24 font-mono text-xs text-fg-muted">--text-{s}</code>
              <span style={{ fontSize: `var(--text-${s})` }}>The quick brown fox jumps</span>
            </div>
          ))}
          <div className="flex items-baseline gap-4">
            <code className="w-24 font-mono text-xs text-fg-muted">--font-mono</code>
            <span className="font-mono">3f2a9c1 feat(design): add tokens</span>
          </div>
        </Section>

        <Section title="Spacing">
          {spaces.map((s) => (
            <div key={s} className="flex items-center gap-4">
              <code className="w-24 font-mono text-xs text-fg-muted">--space-{s}</code>
              <div className="h-3 bg-accent" style={{ width: `var(--space-${s})` }} />
            </div>
          ))}
          <Row label="Controls">
            {(["sm", "md", "lg"] as const).map((c) => (
              <div
                key={c}
                className="flex items-center rounded-md border border-border px-2 font-mono text-xs text-fg-muted"
                style={{ height: `var(--control-${c})` }}
              >
                --control-{c}
              </div>
            ))}
          </Row>
        </Section>

        <Section title="Radius">
          <div className="flex gap-3">
            {radii.map((r) => (
              <div
                key={r}
                className="flex size-16 items-center justify-center border border-border-strong bg-surface font-mono text-xs text-fg-muted"
                style={{ borderRadius: `var(--radius-${r})` }}
              >
                {r}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Shadows">
          <div className="flex gap-4">
            {shadows.map((s) => (
              <div
                key={s}
                className="flex size-20 items-center justify-center rounded-md border border-border bg-surface-raised font-mono text-xs text-fg-muted"
                style={{ boxShadow: `var(--shadow-${s})` }}
              >
                {s}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Gradients">
          <div
            className="flex h-32 items-end rounded-lg border border-border p-3 font-mono text-xs text-fg-muted"
            style={{ background: "var(--gradient-chrome)" }}
          >
            --gradient-chrome (app chrome and empty states only)
          </div>
        </Section>

        <Section title="Z-index and motion">
          <div className="flex flex-wrap gap-2">
            {zIndexes.map((z) => (
              <Badge key={z}>--z-{z}</Badge>
            ))}
            <Badge variant="accent">--duration-fast 120ms</Badge>
            <Badge variant="accent">--duration-base 180ms</Badge>
          </div>
        </Section>

        <Components />
      </main>
      <Toaster />
    </div>
  );
}

export default function DesignPage() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <Page />
      </TooltipProvider>
    </ThemeProvider>
  );
}
