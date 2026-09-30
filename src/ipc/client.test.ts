import { describe, expect, it } from "vitest";
import { IpcError, isIpcError, unwrap } from "./client";

describe("unwrap", () => {
  it("returns data on ok", async () => {
    await expect(unwrap(Promise.resolve({ status: "ok" as const, data: 42 }))).resolves.toBe(42);
  });

  it("throws a typed IpcError on error", async () => {
    const pending = unwrap(
      Promise.resolve({
        status: "error" as const,
        error: { kind: "notARepo" as const, message: "nope", detail: null },
      }),
    );
    await expect(pending).rejects.toBeInstanceOf(IpcError);
    const err = await pending.catch((e: unknown) => e);
    expect(isIpcError(err) && err.kind).toBe("notARepo");
  });
});
