import { describe, expect, it } from "vitest";
import {
  commonExtension,
  extensionOf,
  extensionPattern,
  ignorePattern,
  patchFileName,
} from "./pathActions";

describe("ignorePattern", () => {
  it("anchors files and folders", () => {
    expect(ignorePattern("src/app.log", false)).toBe("/src/app.log");
    expect(ignorePattern("build/out", true)).toBe("/build/out/");
  });

  it("escapes wildcards and trailing spaces", () => {
    expect(ignorePattern("a*b[1]?.txt", false)).toBe("/a\\*b\\[1\\]\\?.txt");
    expect(ignorePattern("back\\slash", false)).toBe("/back\\\\slash");
    expect(ignorePattern("name  ", false)).toBe("/name\\ \\ ");
  });

  it("protects a leading # or ! with the anchor", () => {
    expect(ignorePattern("#notes", false)).toBe("/#notes");
    expect(ignorePattern("!important", false)).toBe("/!important");
  });
});

describe("extensions", () => {
  it("finds the last extension", () => {
    expect(extensionOf("a/b/file.log")).toBe("log");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("dir.d/file.txt")).toBe("txt");
  });

  it("is null without one", () => {
    expect(extensionOf("Makefile")).toBeNull();
    expect(extensionOf(".env")).toBeNull();
    expect(extensionOf("dir.d/Makefile")).toBeNull();
    expect(extensionOf("trailing.")).toBeNull();
  });

  it("escapes the pattern", () => {
    expect(extensionPattern("log")).toBe("*.log");
    expect(extensionPattern("a[b")).toBe("*.a\\[b");
  });

  it("needs a single shared extension", () => {
    expect(commonExtension(["a.log", "b/c.log"])).toBe("log");
    expect(commonExtension(["a.log", "b.txt"])).toBeNull();
    expect(commonExtension(["a.log", "Makefile"])).toBeNull();
    expect(commonExtension([])).toBeNull();
  });
});

describe("patchFileName", () => {
  it("uses the base name for one path", () => {
    expect(patchFileName(["src/app.ts"])).toBe("app.ts.patch");
    expect(patchFileName(["src/deep"])).toBe("deep.patch");
  });

  it("falls back for several", () => {
    expect(patchFileName(["a", "b"])).toBe("changes.patch");
  });
});
