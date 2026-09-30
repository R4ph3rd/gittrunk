import { branchyRepo } from "../fixtures.mjs";

export const name = "opens a repository and renders the commit graph with details";

export async function run(app, root) {
  const repo = branchyRepo(root);
  await app.openRepo(repo);
  const rows = await app.all('[aria-label="Commit graph"] [role="row"]');
  if (rows.length !== 4) throw new Error(`expected 4 graph rows, got ${rows.length}`);
  await app.click(rows[0]);
  const details = await app.css('[aria-label="Commit details"]');
  const text = await app.text(details);
  if (!text.includes("merge feature into main")) throw new Error(`details: ${text}`);
  await app.screenshot("graph");
}
