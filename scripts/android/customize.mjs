#!/usr/bin/env node
// Customizes the generated Tauri Android project (src-tauri/gen/android).
// Idempotent: a second run changes nothing. Every patch asserts it applied
// exactly once and fails loudly otherwise.
//
//   node scripts/android/customize.mjs                 apply
//   node scripts/android/customize.mjs --check         exit 1 if anything would change
//   node scripts/android/customize.mjs --root <dir>    use another repo root (tests)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIGNING_MARKER = "// gittrunk:signing";
// In a Gradle Kotlin script `java` resolves to the `java` project extension,
// so a fully-qualified `java.util.Properties` does not compile: the block uses
// the simple name and patchGradle guarantees the import at the top.
const PROPERTIES_IMPORT = "import java.util.Properties";
const SIGNING_BLOCK = `${SIGNING_MARKER}
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}
android {
    signingConfigs {
        if (keystorePropsFile.exists()) {
            create("release") {
                keyAlias = keystoreProps["keyAlias"] as String
                keyPassword = keystoreProps["keyPassword"] as String
                storeFile = file(keystoreProps["storeFile"] as String)
                storePassword = keystoreProps["storePassword"] as String
            }
        }
    }
    buildTypes {
        getByName("release") {
            if (keystorePropsFile.exists()) signingConfig = signingConfigs.getByName("release")
        }
    }
}

`;

const GEN_IGNORE = [
  "keystore.properties",
  "local.properties",
  "tauri.properties",
  "build/",
  ".gradle/",
  "/.tauri",
];
const ROOT_IGNORE = ["src-tauri/gen/android/keystore.properties", "*.jks"];

function fail(msg) {
  throw new Error(`customize: ${msg}`);
}

function countOf(text, needle) {
  return text.split(needle).length - 1;
}

export function patchGradle(src) {
  let out = src;
  if (countOf(out, "\nrust {") !== 1)
    fail("expected exactly one `rust {` block in app/build.gradle.kts");
  const markers = countOf(out, SIGNING_MARKER);
  if (markers > 1) fail("signing block must exist exactly once");
  if (markers === 0) {
    out = out.replace("\nrust {", () => `\n${SIGNING_BLOCK}rust {`);
  } else {
    // Rewrite an existing (possibly outdated) block: it spans from the marker
    // to the `rust {` block it was inserted in front of.
    const start = out.indexOf(SIGNING_MARKER);
    const end = out.indexOf("\nrust {");
    if (end < start) fail("signing block must sit right before the `rust {` block");
    out = `${out.slice(0, start)}${SIGNING_BLOCK}${out.slice(end + 1)}`;
  }
  if (!new RegExp(`^${PROPERTIES_IMPORT}$`, "m").test(out)) out = `${PROPERTIES_IMPORT}\n${out}`;
  if (/\bjava\.util\.Properties\(/.test(out))
    fail("use `Properties()` with an import: `java.` is the Gradle `java` extension in .kts");
  // Release must resolve usesCleartextTraffic to false; only debug may enable it.
  if (
    !/defaultConfig\s*\{[^}]*manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"false"/.test(out)
  )
    fail('defaultConfig must set manifestPlaceholders["usesCleartextTraffic"] = "false"');
  const release = out.match(/getByName\("release"\)\s*\{[\s\S]*?\n {8}\}/);
  if (!release) fail("release build type not found");
  if (/usesCleartextTraffic/.test(release[0]))
    fail("release build type must not override usesCleartextTraffic");
  if (!/getByName\("debug"\)\s*\{[^}]*usesCleartextTraffic"\]\s*=\s*"true"/.test(out))
    fail("debug build type must keep usesCleartextTraffic = true");
  return out;
}

function setAttr(text, tagRe, name, value, what) {
  const m = text.match(tagRe);
  if (!m || countOf(text, m[0]) !== 1) fail(`${what} not found exactly once`);
  const tag = m[0];
  const attrRe = new RegExp(`android:${name}="[^"]*"`);
  const next = attrRe.test(tag)
    ? tag.replace(attrRe, `android:${name}="${value}"`)
    : tag.replace(/^(<\w+)/, `$1\n        android:${name}="${value}"`);
  return text.replace(tag, () => next);
}

export function patchManifest(src) {
  if (!src.includes('android:name="android.permission.INTERNET"'))
    fail("AndroidManifest.xml lacks android.permission.INTERNET");
  if (!src.includes("${usesCleartextTraffic}"))
    fail("manifest lost the ${usesCleartextTraffic} placeholder");
  let out = setAttr(src, /<application\b[^>]*>/, "allowBackup", "false", "<application>");
  out = setAttr(
    out,
    /<activity\b(?=[^>]*android:name="\.MainActivity")[^>]*>/,
    "windowSoftInputMode",
    "adjustResize",
    "MainActivity <activity>",
  );
  if (countOf(out, 'android:allowBackup="false"') !== 1) fail("allowBackup patch failed");
  if (countOf(out, 'android:windowSoftInputMode="adjustResize"') !== 1)
    fail("windowSoftInputMode patch failed");
  return out;
}

export function patchIgnore(src, lines, equivalents = {}) {
  const have = new Set(src.split(/\r?\n/).map((l) => l.trim()));
  const missing = lines.filter(
    (l) => !have.has(l) && !(equivalents[l] ?? []).some((e) => have.has(e)),
  );
  if (missing.length === 0) return src;
  const base = src.endsWith("\n") || src === "" ? src : `${src}\n`;
  return `${base}${missing.join("\n")}\n`;
}

function listFiles(dir) {
  const res = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) res.push(...listFiles(p));
    else res.push(p);
  }
  return res;
}

export function run(root, check) {
  const android = path.join(root, "src-tauri/gen/android");
  const icons = path.join(root, "src-tauri/icons/android");
  if (!fs.existsSync(android)) fail(`${android} does not exist (run tauri android init first)`);
  if (!fs.existsSync(icons)) fail(`${icons} does not exist`);
  const changes = [];
  const plan = (file, next) => {
    const cur = fs.existsSync(file) ? fs.readFileSync(file) : null;
    const nextBuf = Buffer.isBuffer(next) ? next : Buffer.from(next);
    if (cur === null || !cur.equals(nextBuf)) changes.push([file, nextBuf]);
  };
  const editText = (file, fn) => {
    if (!fs.existsSync(file)) fail(`missing ${file}`);
    plan(file, fn(fs.readFileSync(file, "utf8")));
  };

  const res = path.join(android, "app/src/main/res");
  for (const f of listFiles(icons))
    plan(path.join(res, path.relative(icons, f)), fs.readFileSync(f));
  editText(path.join(android, "app/build.gradle.kts"), patchGradle);
  editText(path.join(android, "app/src/main/AndroidManifest.xml"), patchManifest);
  const ignoreFile = path.join(android, ".gitignore");
  plan(
    ignoreFile,
    patchIgnore(fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8") : "", GEN_IGNORE, {
      "build/": ["build", "/build"],
      ".gradle/": [".gradle"],
    }),
  );
  const rootIgnore = path.join(root, ".gitignore");
  if (fs.existsSync(rootIgnore)) editText(rootIgnore, (s) => patchIgnore(s, ROOT_IGNORE));

  if (check) {
    for (const [f] of changes)
      console.error(`customize --check: would change ${path.relative(root, f)}`);
    return changes.length === 0 ? 0 : 1;
  }
  for (const [f, data] of changes) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
    console.log(`customize: updated ${path.relative(root, f)}`);
  }
  if (changes.length === 0) console.log("customize: nothing to do");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ri = args.indexOf("--root");
  const root =
    ri >= 0
      ? path.resolve(args[ri + 1])
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  try {
    process.exit(run(root, args.includes("--check")));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
