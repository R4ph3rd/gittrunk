import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { resetBackStackForTests } from "../app/layout/back";
import { resetViewport } from "./viewport";

// Slow CI runners: a query that misses a 1s findBy/waitFor window leaves work
// pending and cascades into act() warnings, so give the UI room to settle.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

// Fail loudly if React reports a state update outside act(). Such warnings
// mean a test ended (or asserted) before the UI settled.
const actWarnings: string[] = [];
const realError = console.error.bind(console);

beforeEach(() => {
  actWarnings.length = 0;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (text.includes("not wrapped in act")) {
      actWarnings.push(`${String(args[1])}: ${text.split("\n")[0] ?? text}`);
      return;
    }
    realError(...args);
  });
});

afterEach(() => {
  vi.mocked(console.error).mockRestore();
  if (actWarnings.length > 0) {
    const list = actWarnings.join("\n");
    actWarnings.length = 0;
    throw new Error(`React act() warnings during test:\n${list}`);
  }
});

afterEach(() => {
  resetViewport();
  resetBackStackForTests();
});
