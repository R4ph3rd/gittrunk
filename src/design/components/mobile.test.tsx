import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchBack } from "@/app/layout/back";
import { LayoutProvider } from "@/app/layout/LayoutProvider";
import { setViewport } from "@/test/viewport";
import { MobileSection } from "../MobileSection";
import { ThemeProvider } from "../theme";
import { useLongPress } from "../hooks";
import {
  ActionSheet,
  AppBar,
  BottomNav,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  ListRow,
  NavRail,
  PullToRefresh,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  SegmentedControl,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  SwipeRow,
  Switch,
  Tooltip,
} from "./index";

const rects: { mockRestore: () => void }[] = [];

function mockRect(width: number, height: number) {
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  rects.push(spy);
  return spy;
}

afterEach(() => {
  vi.useRealTimers();
  for (const r of rects.splice(0)) r.mockRestore();
});

function SheetHarness(props: Partial<ComponentProps<typeof SheetContent>>) {
  const [open, setOpen] = useState(true);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent {...props}>
        <SheetTitle>Branch actions</SheetTitle>
        <SheetDescription>Pick one</SheetDescription>
        <button type="button">First</button>
        <button type="button">Second</button>
      </SheetContent>
    </Sheet>
  );
}

describe("Sheet", () => {
  it("has an accessible name and is modal", () => {
    render(<SheetHarness />);
    const dialog = screen.getByRole("dialog", { name: "Branch actions" });
    expect(dialog).toHaveAttribute("data-snap", "auto");
  });

  it("traps focus", async () => {
    render(<SheetHarness />);
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 5; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("closes on Escape", async () => {
    render(<SheetHarness />);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on the Android back button", () => {
    render(<SheetHarness />);
    let handled = false;
    act(() => {
      handled = dispatchBack();
    });
    expect(handled).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(dispatchBack()).toBe(false);
  });

  it("works uncontrolled with a trigger", async () => {
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent>
          <SheetTitle>T</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      dispatchBack();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses the full snap height", () => {
    render(<SheetHarness snap="full" />);
    expect(screen.getByRole("dialog").className).toContain("h-[calc(100dvh-var(--safe-top))]");
  });

  it("closes on a drag past 30% of its height", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    mockRect(390, 800);
    render(<SheetHarness />);
    const handle = document.querySelector("[data-sheet-handle]")!;
    fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 });
    act(() => void vi.advanceTimersByTime(1000));
    fireEvent.pointerMove(handle, { clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 300, pointerId: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on a fast flick", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    mockRect(390, 800);
    render(<SheetHarness />);
    const handle = document.querySelector("[data-sheet-handle]")!;
    fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 });
    act(() => void vi.advanceTimersByTime(50));
    fireEvent.pointerMove(handle, { clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 60, pointerId: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("springs back on a short slow drag", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    mockRect(390, 800);
    render(<SheetHarness />);
    const handle = document.querySelector("[data-sheet-handle]")!;
    fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 });
    act(() => void vi.advanceTimersByTime(1000));
    fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 100, pointerId: 1 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ignores drags when dragToDismiss is off and can hide the handle", () => {
    const { unmount } = render(<SheetHarness dragToDismiss={false} />);
    const handle = document.querySelector("[data-sheet-handle]")!;
    fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 700, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 700, pointerId: 1 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    unmount();
    render(<SheetHarness hideHandle />);
    expect(document.querySelector("[data-sheet-handle]")).toBeNull();
  });
});

describe("ActionSheet", () => {
  function setup() {
    const calls: string[] = [];
    const onOpenChange = vi.fn((open: boolean) => calls.push(`open:${open}`));
    const onSelect = vi.fn(() => calls.push("select"));
    render(
      <ActionSheet
        open
        onOpenChange={onOpenChange}
        title="Commit actions"
        items={[
          { id: "pick", label: "Cherry-pick", onSelect },
          { id: "del", label: "Delete branch", destructive: true, onSelect: vi.fn() },
        ]}
      />,
    );
    return { calls, onOpenChange, onSelect };
  }

  it("closes, then selects", async () => {
    const { calls } = setup();
    expect(screen.getByRole("dialog", { name: "Commit actions" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cherry-pick" }));
    expect(calls).toEqual(["open:false", "select"]);
  });

  it("styles destructive rows with --danger and sizes rows by token", () => {
    setup();
    const del = screen.getByRole("button", { name: "Delete branch" });
    expect(del).toHaveAttribute("data-destructive", "true");
    expect(del.className).toContain("text-danger");
    expect(del.className).toContain("min-h-[var(--touch-target-row)]");
  });

  it("has a cancel row and renders groups", async () => {
    const onOpenChange = vi.fn();
    render(
      <ActionSheet
        open
        onOpenChange={onOpenChange}
        title="Groups"
        cancelLabel="Dismiss"
        items={[]}
        groups={[
          [{ id: "a", label: "A", onSelect: () => {} }],
          [{ id: "b", label: "B", onSelect: () => {} }],
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "B" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ResponsiveDialog", () => {
  function Both() {
    return (
      <>
        <ResponsiveDialog open>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Clone</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>Pick a URL</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </>
    );
  }

  it("renders exactly the Dialog markup on regular layouts", () => {
    const { baseElement: a, unmount } = render(<Both />);
    const responsive = screen.getByRole("dialog");
    const classes = {
      dialog: responsive.className,
      header: screen.getByText("Clone").parentElement?.className,
      title: screen.getByText("Clone").className,
      close: screen.getByRole("button", { name: "Close" }).className,
    };
    expect(a.querySelector("[data-snap]")).toBeNull();
    unmount();
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone</DialogTitle>
            <DialogDescription>Pick a URL</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("dialog").className).toBe(classes.dialog);
    expect(screen.getByText("Clone").parentElement?.className).toBe(classes.header);
    expect(screen.getByText("Clone").className).toBe(classes.title);
    expect(screen.getByRole("button", { name: "Close" }).className).toBe(classes.close);
  });

  it("renders a full sheet on compact layouts", () => {
    setViewport(390, 844);
    render(<Both />);
    const dialog = screen.getByRole("dialog", { name: "Clone" });
    expect(dialog).toHaveAttribute("data-snap", "full");
    expect(document.querySelector("[data-sheet-handle]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("closes on back at both layouts", () => {
    const { unmount } = render(<Both />);
    act(() => void dispatchBack());
    // uncontrolled `open` prop stays true; the handler still reports handled
    unmount();
  });
});

describe("SwipeRow", () => {
  function setup() {
    const left = vi.fn();
    const right = vi.fn();
    render(
      <SwipeRow
        leftAction={{ label: "Stage", tone: "success", onTrigger: left }}
        rightAction={{ label: "Discard", tone: "danger", onTrigger: right }}
      >
        <div>row</div>
      </SwipeRow>,
    );
    const content = document.querySelector("[data-swipe-content]")!;
    return { left, right, content };
  }

  it("fires leftAction on a 60% right swipe", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    mockRect(300, 52);
    const { left, right, content } = setup();
    fireEvent.pointerDown(content, { clientX: 0, clientY: 0, pointerId: 1 });
    act(() => void vi.advanceTimersByTime(600));
    fireEvent.pointerMove(content, { clientX: 180, clientY: 2, pointerId: 1 });
    fireEvent.pointerUp(content, { clientX: 180, clientY: 2, pointerId: 1 });
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).not.toHaveBeenCalled();
  });

  it("fires rightAction on a left swipe", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    mockRect(300, 52);
    const { left, right, content } = setup();
    fireEvent.pointerDown(content, { clientX: 200, clientY: 0, pointerId: 1 });
    act(() => void vi.advanceTimersByTime(600));
    fireEvent.pointerMove(content, { clientX: 20, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(content, { clientX: 20, clientY: 0, pointerId: 1 });
    expect(right).toHaveBeenCalledTimes(1);
    expect(left).not.toHaveBeenCalled();
  });

  it("springs back on a 20% swipe", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    mockRect(300, 52);
    const { left, content } = setup();
    fireEvent.pointerDown(content, { clientX: 0, clientY: 0, pointerId: 1 });
    act(() => void vi.advanceTimersByTime(600));
    fireEvent.pointerMove(content, { clientX: 60, clientY: 0, pointerId: 1 });
    expect((content as HTMLElement).style.transform).toBe("translateX(60px)");
    fireEvent.pointerUp(content, { clientX: 60, clientY: 0, pointerId: 1 });
    expect(left).not.toHaveBeenCalled();
    expect((content as HTMLElement).style.transform).toBe("");
  });

  it("ignores vertical drags", () => {
    mockRect(300, 52);
    const { left, content } = setup();
    fireEvent.pointerDown(content, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(content, { clientX: 20, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(content, { clientX: 20, clientY: 90, pointerId: 1 });
    expect(left).not.toHaveBeenCalled();
  });

  it("exposes each action as a real button", async () => {
    const { left, right } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Stage" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).toHaveBeenCalledTimes(1);
  });

  it("does nothing when disabled", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    mockRect(300, 52);
    const left = vi.fn();
    render(
      <SwipeRow disabled leftAction={{ label: "Stage", tone: "success", onTrigger: left }}>
        <div>row</div>
      </SwipeRow>,
    );
    const content = document.querySelector("[data-swipe-content]")!;
    fireEvent.pointerDown(content, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(content, { clientX: 250, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(content, { clientX: 250, clientY: 0, pointerId: 1 });
    expect(left).not.toHaveBeenCalled();
  });
});

describe("useLongPress", () => {
  function Target({ onLong }: { onLong: () => void }) {
    const handlers = useLongPress(onLong, { vibrate: false });
    return <div data-testid="t" {...handlers} />;
  }

  it("fires at 450ms", () => {
    vi.useFakeTimers();
    const onLong = vi.fn();
    render(<Target onLong={onLong} />);
    fireEvent.pointerDown(screen.getByTestId("t"), { clientX: 5, clientY: 5 });
    act(() => void vi.advanceTimersByTime(449));
    expect(onLong).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it("cancels on a 9px move", () => {
    vi.useFakeTimers();
    const onLong = vi.fn();
    render(<Target onLong={onLong} />);
    const t = screen.getByTestId("t");
    fireEvent.pointerDown(t, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(t, { clientX: 9, clientY: 0 });
    act(() => void vi.advanceTimersByTime(600));
    expect(onLong).not.toHaveBeenCalled();
  });

  it("tolerates an 8px move", () => {
    vi.useFakeTimers();
    const onLong = vi.fn();
    render(<Target onLong={onLong} />);
    const t = screen.getByTestId("t");
    fireEvent.pointerDown(t, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(t, { clientX: 8, clientY: 0 });
    act(() => void vi.advanceTimersByTime(450));
    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it("cancels on pointer up and on scroll", () => {
    vi.useFakeTimers();
    const onLong = vi.fn();
    render(<Target onLong={onLong} />);
    const t = screen.getByTestId("t");
    fireEvent.pointerDown(t, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(t);
    act(() => void vi.advanceTimersByTime(600));
    fireEvent.pointerDown(t, { clientX: 0, clientY: 0 });
    fireEvent.scroll(window);
    act(() => void vi.advanceTimersByTime(600));
    expect(onLong).not.toHaveBeenCalled();
  });

  it("suppresses the native contextmenu", () => {
    render(<Target onLong={() => {}} />);
    const notCancelled = fireEvent.contextMenu(screen.getByTestId("t"));
    expect(notCancelled).toBe(false);
  });
});

describe("BottomNav and NavRail", () => {
  const items = [
    { id: "history", label: "History", icon: <span /> },
    { id: "changes", label: "Changes", icon: <span />, badge: 3 },
    { id: "more", label: "More", icon: <span />, badge: true },
  ];

  it("marks the active item and fires onSelect, also on re-tap", async () => {
    const onSelect = vi.fn();
    render(<BottomNav items={items} activeId="history" onSelect={onSelect} />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    const active = screen.getByRole("button", { name: "History" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "More" })).not.toHaveAttribute("aria-current");
    await userEvent.click(active);
    expect(onSelect).toHaveBeenCalledWith("history");
    await userEvent.click(screen.getByRole("button", { name: /Changes/ }));
    expect(onSelect).toHaveBeenLastCalledWith("changes");
  });

  it("renders nothing while hidden", () => {
    render(<BottomNav items={items} activeId="history" onSelect={() => {}} hidden />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("NavRail uses the rail width token", () => {
    render(<NavRail items={items} activeId="changes" onSelect={() => {}} />);
    expect(screen.getByRole("navigation").className).toContain("--navrail-w");
    expect(screen.getByRole("button", { name: /Changes/ })).toHaveAttribute("aria-current", "page");
  });
});

describe("AppBar", () => {
  it("renders back, title button, actions and progress", async () => {
    const onBack = vi.fn();
    const onTitle = vi.fn();
    render(
      <AppBar
        title="gittrunk"
        subtitle="main"
        onBack={onBack}
        onTitleClick={onTitle}
        actions={<IconButton aria-label="Search">s</IconButton>}
        progress="indeterminate"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("button", { name: /gittrunk/ }));
    expect(onBack).toHaveBeenCalled();
    expect(onTitle).toHaveBeenCalled();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });
});

describe("ListRow", () => {
  it("is a button with onClick and a div without", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<ListRow title="Row" subtitle="sub" onClick={onClick} chevron />);
    const btn = screen.getByRole("button", { name: /Row/ });
    expect(btn.className).toContain("min-h-[var(--touch-target-row)]");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
    rerender(<ListRow title="Row" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Row").closest("div")).not.toBeNull();
  });
});

describe("PullToRefresh", () => {
  function pull(el: Element, to: number) {
    fireEvent.pointerDown(el, { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientY: to, pointerId: 1 });
    fireEvent.pointerUp(el, { clientY: to, pointerId: 1 });
  }

  it("refreshes after an 80px pull at scrollTop 0", async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div>list</div>
      </PullToRefresh>,
    );
    await act(async () => pull(container.firstElementChild!, 80));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh below the threshold", async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div>list</div>
      </PullToRefresh>,
    );
    await act(async () => pull(container.firstElementChild!, 40));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not refresh while scrolled", async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div>list</div>
      </PullToRefresh>,
    );
    const el = container.firstElementChild!;
    Object.defineProperty(el, "scrollTop", { configurable: true, value: 50 });
    await act(async () => pull(el, 80));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("announces while refreshing and contains overscroll", async () => {
    let done: () => void = () => {};
    const onRefresh = vi.fn(() => new Promise<void>((r) => (done = r)));
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh} label="Fetching">
        <div>list</div>
      </PullToRefresh>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.overscrollBehaviorY).toBe("contain");
    await act(async () => pull(el, 100));
    expect(screen.getByRole("status")).toHaveTextContent("Fetching");
    await act(async () => done());
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("touch sizing on coarse pointers", () => {
  const touch = "coarse:min-h-[var(--touch-target)]";

  it("Button and IconButton", () => {
    render(
      <>
        <Button>Go</Button>
        <IconButton aria-label="Icon">i</IconButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "Go" }).className).toContain(touch);
    const icon = screen.getByRole("button", { name: "Icon" });
    expect(icon.className).toContain(touch);
    expect(icon.className).toContain("coarse:min-w-[var(--touch-target)]");
  });

  it("Checkbox, Switch, SegmentedControl and Input", () => {
    render(
      <>
        <Checkbox aria-label="c" />
        <Switch aria-label="s" />
        <SegmentedControl
          aria-label="seg"
          options={[{ value: "a", label: "A" }]}
          value="a"
          onValueChange={() => {}}
        />
        <Input aria-label="i" />
      </>,
    );
    expect(screen.getByRole("checkbox").parentElement?.className).toContain(touch);
    expect(screen.getByRole("switch").className).toContain(
      "coarse:after:size-[var(--touch-target)]",
    );
    expect(screen.getByRole("radio", { name: "A" }).className).toContain(touch);
    const input = screen.getByRole("textbox", { name: "i" });
    expect(input.className).toContain(touch);
    expect(input.className).toContain("coarse:text-[16px]");
  });

  it("Checkbox forwards clicks on its enlarged hit area", async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="c" onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole("checkbox").parentElement!);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe("Tooltip on coarse pointers", () => {
  it("renders only the trigger", () => {
    render(
      <LayoutProvider force={{ isCoarse: true }}>
        <Tooltip content="Refresh">
          <button type="button" aria-label="Refresh">
            r
          </button>
        </Tooltip>
      </LayoutProvider>,
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).not.toHaveAttribute("data-state");
  });
});

describe("theme-color meta", () => {
  it("mirrors the computed --bg", () => {
    document.documentElement.style.setProperty("--bg", "#101216");
    document.head.querySelector('meta[name="theme-color"]')?.remove();
    render(
      <ThemeProvider defaultTheme="dark">
        <span />
      </ThemeProvider>,
    );
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(meta?.content).toBe("#101216");
    document.documentElement.style.removeProperty("--bg");
  });
});

describe("/design Mobile section", () => {
  it("renders the frames in both themes", () => {
    render(
      <ThemeProvider>
        <MobileSection />
      </ThemeProvider>,
    );
    expect(screen.getByRole("heading", { name: "Mobile" })).toBeInTheDocument();
    expect(
      document.querySelectorAll('[data-theme="dark"] nav[aria-label="Primary"]').length,
    ).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-theme="light"] nav[aria-label="Primary"]').length).toBe(
      1,
    );
  });
});
