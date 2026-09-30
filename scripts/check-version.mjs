// Fails unless package.json, tauri.conf.json and Cargo.toml all carry the
// requested version. Usage: node scripts/check-version.mjs <version>
import { readFileSync } from "node:fs";

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
if (!ok) process.exit(1);
console.log(`All version files match ${expected}`);
