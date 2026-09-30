import type { AppError } from "./bindings";

export type { AppError };

type Result<T> = { status: "ok"; data: T } | { status: "error"; error: AppError };

/** Thrown by `unwrap` so TanStack Query sees a real Error carrying the typed payload. */
export class IpcError extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(error.message);
    this.name = "IpcError";
    this.error = error;
  }

  get kind() {
    return this.error.kind;
  }
}

/** Unwraps a tauri-specta result, throwing `IpcError` on failure. */
export async function unwrap<T>(pending: Promise<Result<T>>): Promise<T> {
  const result = await pending;
  if (result.status === "error") throw new IpcError(result.error);
  return result.data;
}

export function isIpcError(err: unknown): err is IpcError {
  return err instanceof IpcError;
}
