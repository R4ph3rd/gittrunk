// Runs every e2e spec against a debug build of the app via tauri-driver.
// Prereqs: `pnpm tauri build --debug --no-bundle`, `cargo install tauri-driver`,
// and a WebDriver for the platform (WebKitWebDriver on Linux, msedgedriver on Windows).
// On headless Linux run under `xvfb-run`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "./lib.mjs";
import { tempRoot } from "./fixtures.mjs";

const filter = process.argv[2];
const dir = path.join(import.meta.dirname, "specs");
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".spec.mjs") && (!filter || f.includes(filter)))
  .sort();

const driver = spawn("tauri-driver", [], { stdio: "ignore" });
await sleep(2000);

let failed = 0;
for (const file of files) {
  const spec = await import(path.join(dir, file));
  const root = tempRoot();
  const app = await launch();
  const started = Date.now();
  try {
    await spec.run(app, root);
    console.log(`✓ ${spec.name} (${Date.now() - started} ms)`);
  } catch (err) {
    failed++;
    console.log(`✗ ${spec.name}\n  ${err.message}`);
    await app.screenshot(`FAILED-${path.basename(file, ".spec.mjs")}`).catch(() => {});
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
}

driver.kill();
console.log(`\n${files.length - failed}/${files.length} specs passed`);
process.exit(failed ? 1 : 0);
