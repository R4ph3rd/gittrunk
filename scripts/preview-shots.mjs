#!/usr/bin/env node
/* Visual review: screenshots of the dev-only /preview route (mocked IPC backend).
 * Usage: node scripts/preview-shots.mjs [--base http://localhost:1420] [--out <dir>]
 * Needs the dev server running (`pnpm dev`) and Playwright (NODE_PATH or the global install). */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const base = opt("base", "http://localhost:1420");
const out = opt("out", join(process.env.TMPDIR ?? tmpdir(), "gittrunk-preview"));
mkdirSync(out, { recursive: true });

function loadPlaywright() {
  const candidates = [
    ...(process.env.NODE_PATH ?? "")
      .split(":")
      .filter(Boolean)
      .map((p) => join(p, "playwright")),
    "/opt/node22/lib/node_modules/playwright",
    "playwright",
  ];
  for (const c of candidates) {
    try {
      return createRequire(import.meta.url)(c);
    } catch {
      /* try the next one */
    }
  }
  throw new Error("Playwright not found: set NODE_PATH or install it globally");
}
const { chromium } = loadPlaywright();

const DESKTOP = { width: 1400, height: 900 };
const COMPACT = { width: 390, height: 844 };
const ANDROID = "platform=android";

const tab = (page, re) =>
  page
    .getByRole("tab", { name: re })
    .or(page.getByRole("button", { name: re }))
    .first();

/** name, query string, viewport, optional action after load (best effort). */
const shots = [
  { name: "desktop-dark-graph", q: "theme=dark" },
  { name: "desktop-light-graph", q: "theme=light" },
  {
    name: "desktop-dark-hover-card",
    q: "theme=dark",
    act: async (page) => {
      const row = page.locator('[aria-label="Commit graph"] [role="row"]').nth(3);
      await row.hover();
      await page.waitForTimeout(700);
    },
  },
  { name: "desktop-dark-changes-tree", q: "theme=dark&right=changes&tree=1", tree: true },
  { name: "desktop-dark-diff-center", q: "theme=dark&select=2&center=diff" },
  { name: "desktop-dark-worktree-diff", q: "theme=dark&right=changes&center=worktree" },
  { name: "desktop-dark-issue", q: "theme=dark&center=issue" },
  {
    name: "desktop-dark-terminal",
    q: "theme=dark&panels=sidebar,bottom,right",
    act: (page) => page.waitForTimeout(1500),
  },
  {
    name: "desktop-dark-toolbar-menu",
    q: "theme=dark",
    act: async (page) => {
      await page
        .getByRole("button", { name: /undo (options|menu)|more undo|redo/i })
        .first()
        .click({ timeout: 2000 });
      await page.waitForTimeout(300);
    },
  },
  { name: "desktop-light-issues", q: "theme=light&center=issues" },
  { name: "compact-history", q: ANDROID, size: COMPACT },
  {
    name: "compact-issues",
    q: ANDROID,
    size: COMPACT,
    act: (page) => tab(page, /^issues$/i).click({ timeout: 2000 }),
  },
  {
    name: "compact-issue",
    q: ANDROID,
    size: COMPACT,
    act: async (page) => {
      await tab(page, /^issues$/i).click({ timeout: 2000 });
      await page
        .getByText(/Add a terminal panel|Graph stutters/)
        .first()
        .click({ timeout: 2000 });
    },
  },
  {
    name: "compact-more",
    q: ANDROID,
    size: COMPACT,
    act: (page) => tab(page, /^more$/i).click({ timeout: 2000 }),
  },
  {
    name: "compact-commit",
    q: ANDROID,
    size: COMPACT,
    act: (page) =>
      page
        .getByText(/Merge branch|feat\(|fix\(|chore\(/)
        .first()
        .click({ timeout: 2000 }),
  },
];

const browser = await chromium.launch();
const files = [];
const problems = [];

for (const shot of shots) {
  const context = await browser.newContext({ viewport: shot.size ?? DESKTOP });
  if (shot.tree) {
    await context.addInitScript(() => window.localStorage.setItem("gittrunk.fileListMode", "tree"));
  }
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`${shot.name}: pageerror ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`${shot.name}: console.error ${m.text()}`);
  });
  try {
    await page.goto(`${base}/preview?${shot.q}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    if (shot.act) {
      try {
        await shot.act(page);
        await page.waitForTimeout(400);
      } catch (e) {
        // Views that are not implemented yet may lack the element: not an error.
        console.warn(`warn ${shot.name}: action skipped (${String(e.message).split("\n")[0]})`);
      }
    }
    const file = join(out, `${shot.name}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  } catch (e) {
    problems.push(`${shot.name}: ${e.message}`);
  }
  await context.close();
}
await browser.close();

console.log(files.join("\n"));
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
