import { describe, expect, it } from "vitest";
import { change } from "@/app/testing";
import { buildTree, filesUnder, flattenVisible } from "./fileTree";

describe("buildTree", () => {
  it("sorts folders first, then files, case-insensitively", () => {
    const tree = buildTree([
      change("b.ts"),
      change("Zeta/x.ts"),
      change("A.ts"),
      change("alpha/y.ts"),
      change("alpha/z.ts"),
    ]);
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual([
      "folder:alpha",
      "folder:Zeta",
      "file:A.ts",
      "file:b.ts",
    ]);
  });

  it("compacts single-child folder chains and counts files", () => {
    const tree = buildTree([
      change("src/features/staging/a.ts"),
      change("src/features/staging/b.ts"),
      change("README.md"),
    ]);
    expect(tree[0]).toMatchObject({
      kind: "folder",
      name: "src/features/staging",
      path: "src/features/staging",
      count: 2,
    });
  });

  it("does not compact a folder that also holds files", () => {
    const [src] = buildTree([change("src/a.ts"), change("src/deep/b.ts")]);
    expect(src).toMatchObject({ name: "src", count: 2 });
    expect(src?.kind === "folder" && src.children.map((c) => c.name)).toEqual(["deep", "a.ts"]);
  });

  it("places renamed files by their new path", () => {
    const tree = buildTree([{ ...change("new/dir/f.ts", "renamed"), oldPath: "old/f.ts" }]);
    expect(tree[0]).toMatchObject({ kind: "folder", name: "new/dir" });
    expect(tree[0] && filesUnder(tree[0]).map((f) => f.path)).toEqual(["new/dir/f.ts"]);
  });
});

describe("flattenVisible", () => {
  it("hides children of collapsed folders and tracks levels", () => {
    const tree = buildTree([change("a/b.ts"), change("a/c/d.ts"), change("a/c/e.ts")]);
    const all = flattenVisible(tree, () => false);
    expect(all.map((i) => `${i.level}:${i.node.name}`)).toEqual([
      "1:a",
      "2:c",
      "3:d.ts",
      "3:e.ts",
      "2:b.ts",
    ]);
    const collapsed = flattenVisible(tree, (p) => p === "a/c");
    expect(collapsed.map((i) => i.node.name)).toEqual(["a", "c", "b.ts"]);
  });
});
