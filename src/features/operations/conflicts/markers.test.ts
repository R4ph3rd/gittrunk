import { describe, expect, it } from "vitest";
import { countConflicts, nextBlock, parseConflicts, resolveAll, resolveBlock } from "./markers";

const two = [
  "top",
  "<<<<<<< HEAD",
  "ours1",
  "ours2",
  "=======",
  "theirs1",
  ">>>>>>> feature",
  "bottom",
].join("\n");
const diff3 = [
  "a",
  "<<<<<<< HEAD",
  "ours",
  "||||||| base-sha",
  "base",
  "=======",
  "theirs",
  ">>>>>>> feature",
  "b",
].join("\n");

describe("parseConflicts", () => {
  it("parses a 2-way block with labels and offsets", () => {
    const [b] = parseConflicts(two);
    expect(b).toMatchObject({
      index: 0,
      oursLabel: "HEAD",
      theirsLabel: "feature",
      ours: ["ours1", "ours2"],
      theirs: ["theirs1"],
      base: null,
      startLine: 1,
      endLine: 6,
    });
    expect(two.slice(b!.from, b!.to)).toBe(
      "<<<<<<< HEAD\nours1\nours2\n=======\ntheirs1\n>>>>>>> feature",
    );
  });

  it("parses diff3 markers with a base section", () => {
    const [b] = parseConflicts(diff3);
    expect(b).toMatchObject({
      ours: ["ours"],
      base: ["base"],
      theirs: ["theirs"],
      baseLabel: "base-sha",
    });
  });

  it("parses several blocks and counts them", () => {
    const text = `${two}\nmid\n${diff3}`;
    expect(parseConflicts(text).map((b) => b.index)).toEqual([0, 1]);
    expect(countConflicts(text)).toBe(2);
    expect(countConflicts("no markers\n=======\n")).toBe(0);
  });

  it("treats marker-looking text as content and ignores unterminated blocks", () => {
    expect(countConflicts("<<<<<<<< eight\nx\n=======\ny\n>>>>>>>> eight")).toBe(0);
    expect(countConflicts("<<<<<<< HEAD\nno end\n=======\nx")).toBe(0);
    const nested = "<<<<<<< A\n<<<<<<< inner\n=======\nt\n>>>>>>> B";
    const [b] = parseConflicts(nested);
    expect(b!.ours).toEqual(["<<<<<<< inner"]);
    expect(parseConflicts(nested)).toHaveLength(1);
  });

  it("supports CRLF", () => {
    const crlf = two.replace(/\n/g, "\r\n");
    const [b] = parseConflicts(crlf);
    expect(b!.eol).toBe("\r\n");
    expect(b!.ours).toEqual(["ours1", "ours2"]);
    expect(resolveBlock(crlf, 0, "both")).toBe("top\r\nours1\r\nours2\r\ntheirs1\r\nbottom");
  });
});

describe("resolve", () => {
  it("accepts ours, theirs, both and base", () => {
    expect(resolveBlock(two, 0, "ours")).toBe("top\nours1\nours2\nbottom");
    expect(resolveBlock(two, 0, "theirs")).toBe("top\ntheirs1\nbottom");
    expect(resolveBlock(two, 0, "both")).toBe("top\nours1\nours2\ntheirs1\nbottom");
    expect(resolveBlock(diff3, 0, "base")).toBe("a\nbase\nb");
  });

  it("leaves the text alone when base is unavailable", () => {
    expect(resolveBlock(two, 0, "base")).toBe(two);
  });

  it("removes an empty side without leaving a blank line", () => {
    const text = "x\n<<<<<<< HEAD\n=======\nt\n>>>>>>> f\ny";
    expect(resolveBlock(text, 0, "ours")).toBe("x\ny");
  });

  it("resolves only the chosen block and all blocks", () => {
    const text = `${two}\nmid\n${diff3}`;
    expect(countConflicts(resolveBlock(text, 0, "ours"))).toBe(1);
    expect(resolveAll(text, "theirs")).toBe("top\ntheirs1\nbottom\nmid\na\ntheirs\nb");
  });
});

describe("nextBlock", () => {
  const blocks = parseConflicts(`${two}\nmid\n${diff3}`);
  it("moves forward and backward with wrap-around", () => {
    expect(nextBlock(blocks, 0, 1)).toBe(0);
    expect(nextBlock(blocks, blocks[0]!.from, 1)).toBe(1);
    expect(nextBlock(blocks, blocks[1]!.from, 1)).toBe(0);
    expect(nextBlock(blocks, blocks[1]!.from, -1)).toBe(0);
    expect(nextBlock(blocks, blocks[0]!.from, -1)).toBe(1);
    expect(nextBlock([], 0, 1)).toBe(-1);
  });
});
