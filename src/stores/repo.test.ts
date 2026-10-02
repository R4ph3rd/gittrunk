import { beforeEach, describe, expect, it } from "vitest";
import type { RepoInfo } from "@/ipc/bindings";
import { useRepoStore } from "./repo";

const st = () => useRepoStore.getState();

const info = (id: string): RepoInfo => ({
  id,
  path: `/work/${id}`,
  name: id,
  head: { kind: "detached", oid: "0".repeat(40) },
  state: "clean",
  isBare: false,
});

describe("repo store tab model", () => {
  beforeEach(() => {
    useRepoStore.setState({
      repos: [],
      activeId: null,
      page: { kind: "repo" },
      newTabs: [],
      selection: {},
      filters: {},
    });
  });

  it("starts on the repository page with no placeholders", () => {
    expect(st().page).toEqual({ kind: "repo" });
    expect(st().newTabs).toEqual([]);
  });

  it("openNewTab appends, shows and returns a unique id", () => {
    const a = st().openNewTab();
    const b = st().openNewTab();
    expect(a).toMatch(/^new-\d+$/);
    expect(b).not.toBe(a);
    expect(st().newTabs).toEqual([a, b]);
    expect(st().page).toEqual({ kind: "newTab", id: b });
  });

  it("closeNewTab of a hidden placeholder keeps the page", () => {
    const a = st().openNewTab();
    const b = st().openNewTab();
    st().closeNewTab(a);
    expect(st().newTabs).toEqual([b]);
    expect(st().page).toEqual({ kind: "newTab", id: b });
  });

  it("closeNewTab of the shown one shows the one now at the same index, else the previous", () => {
    const a = st().openNewTab();
    const b = st().openNewTab();
    const c = st().openNewTab();
    useRepoStore.setState({ page: { kind: "newTab", id: b } });
    st().closeNewTab(b);
    expect(st().page).toEqual({ kind: "newTab", id: c });
    st().closeNewTab(c);
    expect(st().page).toEqual({ kind: "newTab", id: a });
    st().closeNewTab(a);
    expect(st().newTabs).toEqual([]);
    expect(st().page).toEqual({ kind: "repo" });
  });

  it("closeNewTab ignores unknown ids", () => {
    const a = st().openNewTab();
    st().closeNewTab("nope");
    expect(st().newTabs).toEqual([a]);
    expect(st().page).toEqual({ kind: "newTab", id: a });
  });

  it("showHome and showRepoPage switch the page", () => {
    st().showHome();
    expect(st().page).toEqual({ kind: "home" });
    st().showRepoPage();
    expect(st().page).toEqual({ kind: "repo" });
  });

  it("addRepo shows the repo page and replaces the shown placeholder", () => {
    const a = st().openNewTab();
    const b = st().openNewTab();
    useRepoStore.setState({ page: { kind: "newTab", id: a } });
    st().addRepo(info("r1"));
    expect(st().page).toEqual({ kind: "repo" });
    expect(st().newTabs).toEqual([b]);
    expect(st().activeId).toBe("r1");
  });

  it("addRepo from Home keeps the placeholders", () => {
    const a = st().openNewTab();
    st().showHome();
    st().addRepo(info("r1"));
    expect(st().page).toEqual({ kind: "repo" });
    expect(st().newTabs).toEqual([a]);
  });

  it("setActive leaves Home and placeholder pages", () => {
    st().addRepo(info("r1"));
    st().addRepo(info("r2"));
    st().showHome();
    st().setActive("r1");
    expect(st().page).toEqual({ kind: "repo" });
    expect(st().activeId).toBe("r1");
    st().openNewTab();
    st().setActive("r2");
    expect(st().page).toEqual({ kind: "repo" });
    expect(st().newTabs).toHaveLength(1);
  });
});
