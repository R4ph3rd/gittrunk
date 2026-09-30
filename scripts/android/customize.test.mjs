import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "customize.mjs");
const fx = (n) => fs.readFileSync(path.join(here, "fixtures", n), "utf8");

function setup(mutate = (s) => s) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "customize-"));
  const a = path.join(root, "src-tauri/gen/android");
  const w = (p, c) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, c);
  };
  w(path.join(a, "app/build.gradle.kts"), fx("app.build.gradle.kts"));
  w(path.join(a, "app/src/main/AndroidManifest.xml"), mutate(fx("AndroidManifest.xml")));
  w(path.join(a, ".gitignore"), fx("gen.gitignore"));
  w(path.join(root, "src-tauri/icons/android/mipmap-hdpi/ic_launcher.png"), "png");
  w(path.join(root, ".gitignore"), "node_modules\n");
  return { root, a };
}
const run = (root, ...args) =>
  spawnSync(process.execPath, [script, "--root", root, ...args], { encoding: "utf8" });

test("applies every patch", () => {
  const { root, a } = setup();
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  const gradle = fs.readFileSync(path.join(a, "app/build.gradle.kts"), "utf8");
  assert.equal(gradle.split('rootProject.file("keystore.properties")').length - 1, 1);
  assert.match(gradle, /signingConfig = signingConfigs\.getByName\("release"\)/);
  const manifest = fs.readFileSync(path.join(a, "app/src/main/AndroidManifest.xml"), "utf8");
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
  assert.ok(manifest.includes("${usesCleartextTraffic}"));
  const ignore = fs.readFileSync(path.join(a, ".gitignore"), "utf8").split("\n");
  for (const l of ["keystore.properties", "local.properties", "tauri.properties", "/.tauri"])
    assert.ok(ignore.includes(l), l);
  assert.ok(fs.existsSync(path.join(a, "app/src/main/res/mipmap-hdpi/ic_launcher.png")));
  const rootIgnore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(rootIgnore, /\*\.jks/);
  assert.match(rootIgnore, /src-tauri\/gen\/android\/keystore\.properties/);
});

test("second run is a no-op and --check passes", () => {
  const { root } = setup();
  assert.equal(run(root).status, 0);
  const again = run(root);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /nothing to do/);
  assert.equal(run(root, "--check").status, 0);
});

test("--check exits 1 on an unpatched project and does not write", () => {
  const { root, a } = setup();
  const before = fs.readFileSync(path.join(a, "app/build.gradle.kts"), "utf8");
  assert.equal(run(root, "--check").status, 1);
  assert.equal(fs.readFileSync(path.join(a, "app/build.gradle.kts"), "utf8"), before);
});

test("fails when INTERNET is missing", () => {
  const { root } = setup((s) =>
    s.replace("android.permission.INTERNET", "android.permission.OTHER"),
  );
  const r = run(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /INTERNET/);
});
