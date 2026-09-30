// Fails unless package.json, tauri.conf.json and Cargo.toml all carry the
// requested version. Usage: node scripts/check-version.mjs <version>
// Also rejects minor/patch >= 1000: Tauri derives the Android versionCode as
// major*1000000 + minor*1000 + patch, so larger parts would collide.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Returns an error message when the version cannot map to an Android versionCode, else null. */
export function androidVersionCodeError(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return null;
  const [minor, patch] = [Number(m[2]), Number(m[3])];
  if (minor >= 1000 || patch >= 1000) {
    return `version ${version}: minor and patch must be below 1000 because the Android versionCode is major*1000000 + minor*1000 + patch`;
  }
  return null;
}

function main() {
  const expected = process.argv[2];
  if (!expected) {
    console.error("Usage: node scripts/check-version.mjs <version>");
    process.exit(2);
  }

  const root = new URL("../", import.meta.url);
  const read = (p) => readFileSync(new URL(p, root), "utf8");

  const cargo = /^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"));
  const found = {
    "package.json": JSON.parse(read("package.json")).version,
    "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
    "src-tauri/Cargo.toml": cargo ? cargo[1] : undefined,
  };

  let ok = true;
  for (const [file, version] of Object.entries(found)) {
    if (version !== expected) {
      ok = false;
      console.error(`::error file=${file}::${file} has version ${version}, expected ${expected}`);
    }
  }
  const codeError = androidVersionCodeError(expected);
  if (codeError) {
    ok = false;
    console.error(`::error::${codeError}`);
  }
  if (!ok) process.exit(1);
  console.log(`All version files match ${expected}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
