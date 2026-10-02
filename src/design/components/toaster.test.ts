import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast as sonnerToast } from "sonner";
import { useNotificationsStore } from "@/stores/notifications";
import { toast } from "./Toaster";

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  }),
}));

const items = () => useNotificationsStore.getState().items;

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationsStore.getState().reset();
});

describe("toast wrapper", () => {
  it.each([
    ["success", "success"],
    ["error", "error"],
    ["warning", "warning"],
    ["info", "info"],
    ["message", "info"],
  ] as const)("toast.%s forwards its arguments and records level %s", (method, level) => {
    const opts = { description: "More detail" };
    toast[method]("Hello", opts);
    expect(sonnerToast[method]).toHaveBeenCalledWith("Hello", opts);
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ level, title: "Hello", detail: "More detail" });
  });

  it("records the bare call as info and forwards it", () => {
    toast("Plain");
    expect(sonnerToast).toHaveBeenCalledWith("Plain");
    expect(items()[0]).toMatchObject({ level: "info", title: "Plain", detail: null });
  });

  it("forwards JSX messages without recording them", () => {
    const node = createElement("b", null, "x");
    toast.success(node);
    expect(sonnerToast.success).toHaveBeenCalledWith(node);
    expect(items()).toHaveLength(0);
  });

  it("does not record non-string descriptions", () => {
    toast.error("Failed", { description: createElement("i") });
    expect(items()[0]?.detail).toBeNull();
  });

  it("forwards dismiss and loading without recording", () => {
    toast.dismiss("id");
    toast.loading("Working");
    expect(sonnerToast.dismiss).toHaveBeenCalledWith("id");
    expect(sonnerToast.loading).toHaveBeenCalledWith("Working");
    expect(items()).toHaveLength(0);
  });
});
