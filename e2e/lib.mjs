// Minimal W3C WebDriver client for driving the real Tauri app through tauri-driver.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const WD = process.env.TAURI_DRIVER_URL ?? "http://127.0.0.1:4444";
export const APP =
  process.env.GITTRUNK_APP ??
  path.resolve(
    import.meta.dirname,
    "../src-tauri/target/debug",
    process.platform === "win32" ? "gittrunk.exe" : "gittrunk",
  );
export const ARTIFACTS = path.resolve(import.meta.dirname, "artifacts");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wd(method, url, body) {
  const res = await fetch(WD + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const json = await res.json();
  if (json.value?.error) throw new Error(`${url}: ${json.value.error} ${json.value.message}`);
  return json.value;
}

const elementId = (el) => Object.values(el)[0];

/** Starts the app and returns a small page-object API. */
export async function launch() {
  const session = await wd("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application: APP } } },
  });
  const S = (p) => `/session/${session.sessionId}${p}`;

  const find = async (using, value, timeout = 10_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const els = await wd("POST", S("/elements"), { using, value });
      if (els.length) return els[0];
      await sleep(150);
    }
    throw new Error(`timeout waiting for ${value}`);
  };

  const api = {
    css: (selector, timeout) => find("css selector", selector, timeout),
    xpath: (expr, timeout) => find("xpath", expr, timeout),
    all: (selector) => wd("POST", S("/elements"), { using: "css selector", value: selector }),
    click: (el) => wd("POST", S(`/element/${elementId(el)}/click`), {}),
    type: (el, text) => wd("POST", S(`/element/${elementId(el)}/value`), { text }),
    text: (el) => wd("GET", S(`/element/${elementId(el)}/text`)),
    rect: (el) => wd("GET", S(`/element/${elementId(el)}/rect`)),
    actions: (actions) => wd("POST", S("/actions"), { actions }),
    releaseActions: () => wd("DELETE", S("/actions")),
    refresh: () => wd("POST", S("/refresh"), {}),
    /** Runs `invoke(cmd, args)` in the page and resolves with its result. */
    invoke: (cmd, args) =>
      wd("POST", S("/execute/async"), {
        script:
          "const [c, a, done] = arguments; window.__TAURI_INTERNALS__.invoke(c, a).then(done, (e) => done({ error: e }));",
        args: [cmd, args],
      }),
    /** Opens `repoPath` through the real UI (recent list on the welcome screen). */
    async openRepo(repoPath) {
      await api.css('[data-testid="app-info"]');
      await api.invoke("repo_open", { path: repoPath });
      await api.refresh();
      const name = path.basename(repoPath);
      await api.click(
        await api.xpath(
          `//section[@aria-label='Recent repositories']//button[contains(., '${name}')]`,
        ),
      );
      await api.css('[aria-label="Commit graph"] [role="row"]');
    },
    /** Presses a chord such as ["Control", "z"]. */
    async chord(keys) {
      const map = { Control: "", Shift: "", Alt: "", Meta: "", Enter: "" };
      const values = keys.map((k) => map[k] ?? k);
      await api.actions([
        {
          type: "key",
          id: "keyboard",
          actions: [
            ...values.map((value) => ({ type: "keyDown", value })),
            ...values.reverse().map((value) => ({ type: "keyUp", value })),
          ],
        },
      ]);
    },
    async screenshot(name) {
      fs.mkdirSync(ARTIFACTS, { recursive: true });
      const png = await wd("GET", S("/screenshot"));
      fs.writeFileSync(path.join(ARTIFACTS, `${name}.png`), Buffer.from(png, "base64"));
    },
    close: () => wd("DELETE", S("")),
  };
  return api;
}

/** Runs git synchronously in `cwd` and returns trimmed stdout. */
export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Polls `fn` until it returns a truthy value or throws after `timeout` ms. */
export async function until(fn, message, timeout = 10_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(200);
  }
  throw new Error(`${message} (last value: ${JSON.stringify(last)})`);
}
