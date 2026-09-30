// Fixture repositories created fresh for every e2e run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "./lib.mjs";

const IDENTITY = ["-c", "user.name=Tester", "-c", "user.email=tester@example.com"];

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Tester");
  git(dir, "config", "user.email", "tester@example.com");
  git(dir, "config", "commit.gpgsign", "false");
}

function commit(dir, file, content, message) {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, "add", "--", file);
  git(dir, ...IDENTITY, "commit", "-q", "-m", message);
}

export function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gittrunk-e2e-"));
}

/** main + feature branches with a merge and a tag. */
export function branchyRepo(root) {
  const dir = path.join(root, "branchy");
  init(dir);
  commit(dir, "a.txt", "a\n", "initial commit");
  git(dir, "checkout", "-q", "-b", "feature");
  commit(dir, "b.txt", "b\n", "add feature b");
  git(dir, "checkout", "-q", "main");
  commit(dir, "c.txt", "c\n", "main work c");
  git(dir, ...IDENTITY, "merge", "-q", "--no-ff", "feature", "-m", "merge feature into main");
  git(dir, "tag", "v1.0");
  return dir;
}

/** A clone of a bare remote with uncommitted changes (modified + untracked). */
export function workingCopyWithRemote(root) {
  const remote = path.join(root, "remote.git");
  fs.mkdirSync(remote);
  git(remote, "init", "-q", "--bare", "-b", "main");
  const dir = path.join(root, "work");
  init(dir);
  git(dir, "remote", "add", "origin", remote);
  commit(dir, "a.txt", "one\n", "initial commit");
  git(dir, "push", "-q", "-u", "origin", "main");
  fs.appendFileSync(path.join(dir, "a.txt"), "two\n");
  fs.writeFileSync(path.join(dir, "b.txt"), "new\n");
  return { dir, remote };
}

/** main and an unmerged `feature` branch that merges cleanly. */
export function mergeableRepo(root) {
  const dir = path.join(root, "mergeable");
  init(dir);
  commit(dir, "a.txt", "a\n", "initial commit");
  git(dir, "checkout", "-q", "-b", "feature");
  commit(dir, "f.txt", "f\n", "feature work");
  git(dir, "checkout", "-q", "main");
  commit(dir, "m.txt", "m\n", "main work");
  return dir;
}
