import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AlertDialog, Button, CommandPalette, IconButton } from "./index";

describe("Button", () => {
  it.each(["primary", "secondary", "ghost", "danger", "outline"] as const)(
    "renders the %s variant",
    (variant) => {
      render(<Button variant={variant}>Go</Button>);
      expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
    },
  );

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is disabled and busy while loading", () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole("button", { name: /save/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
});

describe("IconButton", () => {
  it("exposes its aria-label as the accessible name", () => {
    render(<IconButton aria-label="Refresh">x</IconButton>);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("requires aria-label at the type level", () => {
    // @ts-expect-error aria-label is required
    render(<IconButton>x</IconButton>);
  });
});

describe("AlertDialog", () => {
  function setup() {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <AlertDialog
        open
        title="Delete branch?"
        description="This cannot be undone."
        preview={<span>feature/x</span>}
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    return { onConfirm, onCancel };
  }

  it("calls onConfirm", async () => {
    const { onConfirm, onCancel } = setup();
    expect(screen.getByRole("alertdialog", { name: "Delete branch?" })).toBeInTheDocument();
    expect(screen.getByText("feature/x")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel", async () => {
    const { onConfirm, onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("CommandPalette", () => {
  function Harness({ onFetch, onCommit }: { onFetch: () => void; onCommit: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        groups={[
          {
            heading: "Git",
            items: [
              { id: "fetch", label: "Fetch all remotes", onSelect: onFetch },
              {
                id: "commit",
                label: "Commit staged changes",
                shortcut: "Mod+Enter",
                onSelect: onCommit,
              },
            ],
          },
        ]}
      />
    );
  }

  it("filters items and runs the selected command with the keyboard", async () => {
    // cmdk uses these in jsdom
    Element.prototype.scrollIntoView = vi.fn();
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const onFetch = vi.fn();
    const onCommit = vi.fn();
    render(<Harness onFetch={onFetch} onCommit={onCommit} />);

    await userEvent.type(screen.getByRole("combobox"), "commit");
    expect(screen.queryByText("Fetch all remotes")).not.toBeInTheDocument();
    expect(screen.getByText("Commit staged changes")).toBeInTheDocument();

    await userEvent.keyboard("{Enter}");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onFetch).not.toHaveBeenCalled();
  });

  it("shows the empty state when nothing matches", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(<Harness onFetch={vi.fn()} onCommit={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "zzzz");
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });
});
