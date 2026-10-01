import { describe, expect, it } from "vitest";
import { commands } from "@/ipc/bindings";
import { GRAPH_META, GRAPH_ROWS, REF_COLORS, REFS, ROW_COUNT } from "./fixtures";
import { handleCommand, handlers, toSnake } from "./handlers";

describe("preview handlers", () => {
  it("has a handler for every command in bindings.ts", () => {
    for (const name of Object.keys(commands)) {
      expect(handlers[toSnake(name)], name).toBeTypeOf("function");
    }
  });

  it("throws on unknown commands and ignores plugin calls", () => {
    expect(() => handleCommand("does_not_exist")).toThrow(/no mock handler/);
    expect(handleCommand("plugin:dialog|open")).toBeNull();
  });

  it("serves graph windows and dry-run previews", () => {
    expect(handleCommand("graph_rows", { repo: "r", start: 10, len: 5 })).toHaveLength(5);
    const dry = handleCommand("undo", { repo: "r", dryRun: true }) as { kind: string };
    expect(dry.kind).toBe("preview");
    const real = handleCommand("undo", { repo: "r", dryRun: false }) as { kind: string };
    expect(real.kind).toBe("applied");
  });
});

describe("preview fixtures", () => {
  it("builds a consistent graph", () => {
    expect(GRAPH_ROWS).toHaveLength(ROW_COUNT);
    expect(GRAPH_META.laneCount).toBeGreaterThanOrEqual(5);
    const index = new Map(GRAPH_ROWS.map((r) => [r.oid, r.index]));
    expect(index.size).toBe(ROW_COUNT);
    GRAPH_ROWS.forEach((row, i) => {
      expect(row.index).toBe(i);
      expect(row.lane).toBeLessThan(GRAPH_META.laneCount);
      for (const e of row.edges) {
        expect(e.fromLane).toBeLessThan(GRAPH_META.laneCount);
        expect(e.toLane).toBeLessThan(GRAPH_META.laneCount);
      }
      for (const p of row.parents) expect(index.get(p) ?? -1).toBeGreaterThan(i);
    });
    expect(GRAPH_ROWS.some((r) => r.parents.length === 2)).toBe(true);
  });

  it("covers every non-stash ref with a color", () => {
    const colored = new Set(REF_COLORS.map((c) => c.fullName));
    const refs = [
      ...REFS.local.map((b) => b.fullName),
      ...REFS.remote.map((b) => b.fullName),
      ...REFS.tags.map((t) => `refs/tags/${t.name}`),
    ];
    for (const name of refs) expect(colored.has(name), name).toBe(true);
    expect(REFS.local).toHaveLength(3);
    expect(REFS.remote).toHaveLength(6);
    expect(REFS.tags).toHaveLength(2);
    expect(REFS.stashes).toHaveLength(1);
  });
});
