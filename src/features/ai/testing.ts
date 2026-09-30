/* Test helpers for the AI feature. Only imported from tests. */
import { vi } from "vitest";
import type { AiPlan, AiSettings, OpOutcome } from "@/ipc/bindings";

export const baseAiSettings: AiSettings = {
  enabled: true,
  provider: "anthropic",
  model: "claude-haiku-4-5",
  baseUrl: null,
  maxDiffBytes: 60_000,
  hasKey: false,
};

export const samplePlan: AiPlan = {
  id: "plan-1",
  prompt: "make a branch",
  explanation: "Creates the branch and switches to it.",
  steps: [
    {
      description: "Create branch topic",
      command: {
        kind: "branchCreate",
        request: { name: "topic", startPoint: null, checkout: true },
      },
    },
    {
      description: "Merge feature",
      command: {
        kind: "merge",
        request: { source: "feature", into: null, strategy: "auto", message: null },
      },
    },
  ],
  preview: {
    summary: "2 steps: create topic; merge feature",
    refUpdates: [{ name: "refs/heads/topic", from: null, to: "a".repeat(40) }],
    commitsCreated: 0,
    commitsDropped: [],
    predictedConflicts: [],
    warnings: ["This plan changes the repository in 2 steps."],
  },
};

export const appliedOutcome: OpOutcome = {
  kind: "applied",
  oplogId: "op-9",
  head: { kind: "branch", name: "topic", oid: "a".repeat(40) },
  message: "Ran 2 steps.",
};

/** Factory for `vi.mock("@/ipc/bindings", ...)`: the shared mock plus the AI commands. */
export async function aiBindingsMock() {
  const mock = (await import("@/app/mockBindings")).bindingsMock();
  Object.assign(mock.commands, {
    aiSettingsGet: vi.fn(),
    aiSettingsSet: vi.fn(),
    aiKeySet: vi.fn(),
    aiKeyClear: vi.fn(),
    aiPayloadPreview: vi.fn(),
    aiRun: vi.fn(),
    aiPlanExecute: vi.fn(),
  });
  return mock;
}

type Fn = ReturnType<typeof vi.fn>;
export type AiCommands = Record<
  | "aiSettingsGet"
  | "aiSettingsSet"
  | "aiKeySet"
  | "aiKeyClear"
  | "aiPayloadPreview"
  | "aiRun"
  | "aiPlanExecute"
  | "undo",
  Fn
>;

const ok = <T>(data: T) => Promise.resolve({ status: "ok" as const, data });

/** Wires echo-saving settings and a canned preview/run/plan backend. */
export function installAiBackend(
  commands: Record<string, unknown>,
  initial: Partial<AiSettings> = {},
) {
  const c = commands as AiCommands;
  let current: AiSettings = { ...baseAiSettings, ...initial };
  c.aiSettingsGet.mockImplementation(() => ok(current));
  c.aiSettingsSet.mockImplementation((s: AiSettings) => {
    current = { ...s, hasKey: current.hasKey };
    return ok(current);
  });
  c.aiKeySet.mockImplementation(() => {
    current = { ...current, hasKey: true };
    return ok(null);
  });
  c.aiKeyClear.mockImplementation(() => {
    current = { ...current, hasKey: false };
    return ok(null);
  });
  c.aiPayloadPreview.mockImplementation(() =>
    ok({
      bytes: 42,
      files: ["a.txt"],
      truncated: false,
      content: "Staged changes: +hello",
    }),
  );
  c.aiRun.mockImplementation((_r: string, req: { kind: string }) =>
    ok(
      req.kind === "plan"
        ? { kind: "plan", plan: samplePlan }
        : { kind: "text", text: "feat: add hello" },
    ),
  );
  c.aiPlanExecute.mockImplementation(() => ok(appliedOutcome));
  c.undo.mockImplementation(() => ok(appliedOutcome));
  return c;
}
