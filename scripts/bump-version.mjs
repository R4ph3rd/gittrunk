// Sets the version in package.json, tauri.conf.json and Cargo.toml.
// Usage: node scripts/bump-version.mjs <version>   (e.g. 0.2.0, no leading v)
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
if (!version || !semver.test(version)) {
  console.error("Usage: node scripts/bump-version.mjs <semver>, e.g. 0.2.0");
  process.exit(2);
}

const root = new URL("../", import.meta.url);

for (const p of ["package.json", "src-tauri/tauri.conf.json"]) {
  const url = new URL(p, root);
  const text = readFileSync(url, "utf8");
  writeFileSync(url, text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`));
  console.log(`updated ${p}`);
}

const cargo = new URL("src-tauri/Cargo.toml", root);
writeFileSync(
  cargo,
  readFileSync(cargo, "utf8").replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`),
);
console.log("updated src-tauri/Cargo.toml");
console.log(
  "Refresh Cargo.lock with: cargo update -p gittrunk --manifest-path src-tauri/Cargo.toml",
);
