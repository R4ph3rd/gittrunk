import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoFetcher, FOCUS_THROTTLE_MS, INITIAL_DELAY_MS } from "./autoFetch";

const MIN = 60_000;

function setup(over: { remotes?: boolean; busy?: boolean; fail?: boolean } = {}) {
  const state = { remotes: true, busy: false, fail: false, ...over };
  const fetch = vi.fn(async (_id: string) => {
    if (state.fail) throw new Error("offline");
  });
  const fetcher = new AutoFetcher({
    now: () => Date.now(),
    isBusy: () => state.busy,
    hasRemotes: async () => state.remotes,
    fetch,
  });
  return { fetcher, fetch, state };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AutoFetcher", () => {
  it("fetches shortly after a repo opens, then on every interval", async () => {
    const { fetcher, fetch } = setup();
    fetcher.update(["r1"], 5);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenLastCalledWith("r1");
    fetcher.dispose();
  });

  it("does nothing when switched off, and stops when turned off later", async () => {
    const { fetcher, fetch } = setup();
    fetcher.update(["r1"], 0);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    fetcher.focus();
    expect(fetch).not.toHaveBeenCalled();

    fetcher.update(["r1"], 1);
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetcher.update(["r1"], 0);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throttles focus refreshes to once a minute", async () => {
    const { fetcher, fetch } = setup();
    fetcher.update(["r1"], 30);
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FOCUS_THROTTLE_MS - 1_000);
    fetcher.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    fetcher.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetcher.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetcher.dispose();
  });

  it("skips repos without remotes and repos busy with another operation", async () => {
    const { fetcher, fetch, state } = setup({ remotes: false });
    fetcher.update(["r1"], 1);
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);
    expect(fetch).not.toHaveBeenCalled();

    state.remotes = true;
    state.busy = true;
    await vi.advanceTimersByTimeAsync(MIN);
    expect(fetch).not.toHaveBeenCalled();

    state.busy = false;
    await vi.advanceTimersByTimeAsync(MIN);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetcher.dispose();
  });

  it("never overlaps two fetches of the same repo", async () => {
    let release: () => void = () => {};
    const fetch = vi.fn(() => new Promise<void>((r) => (release = r)));
    const fetcher = new AutoFetcher({
      now: () => Date.now(),
      isBusy: () => false,
      hasRemotes: async () => true,
      fetch,
    });
    fetcher.update(["r1"], 1);
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetcher.dispose();
  });

  it("swallows failures and keeps going", async () => {
    const { fetcher, fetch } = setup({ fail: true });
    fetcher.update(["r1"], 1);
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS + MIN);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetcher.dispose();
  });

  it("follows the set of open repositories without refetching the others", async () => {
    const { fetcher, fetch } = setup();
    fetcher.update(["r1"], 5);
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);
    fetcher.update(["r1", "r2"], 5);
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(["r1", "r2"]);
    fetcher.update(["r2"], 5);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(["r1", "r2", "r2"]);
    fetcher.dispose();
  });
});
