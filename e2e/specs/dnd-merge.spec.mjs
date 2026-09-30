import { git, until } from "../lib.mjs";
import { mergeableRepo } from "../fixtures.mjs";

export const name = "merges by dragging the feature label onto the main label";

const center = (r) => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

export async function run(app, root) {
  const dir = mergeableRepo(root);
  const oldMain = git(dir, "rev-parse", "main");
  const featureTip = git(dir, "rev-parse", "feature");
  await app.openRepo(dir);

  const badge = (branch) =>
    app.xpath(
      `//*[@aria-label='Commit graph']//span[@data-kind='localBranch'][normalize-space()='${branch}']`,
    );
  const from = center(await app.rect(await badge("feature")));
  const to = center(await app.rect(await badge("main")));

  const steps = 12;
  const moves = Array.from({ length: steps }, (_, i) => ({
    type: "pointerMove",
    duration: 40,
    origin: "viewport",
    x: Math.round(from.x + ((to.x - from.x) * (i + 1)) / steps),
    y: Math.round(from.y + ((to.y - from.y) * (i + 1)) / steps),
  }));
  await app.actions([
    {
      type: "pointer",
      id: "mouse",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", duration: 0, origin: "viewport", ...from },
        { type: "pointerDown", button: 0 },
        ...moves,
        { type: "pause", duration: 200 },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
  await app.releaseActions();

  await app.click(
    await app.xpath("//*[@role='menuitem'][normalize-space()='Merge feature into main']"),
  );

  const dialog = "//*[@role='alertdialog']";
  await app.xpath(`${dialog}//*[@data-testid='mini-graph']`);
  await app.screenshot("dnd-merge-preview");
  await app.click(await app.xpath(`${dialog}//button[normalize-space()='Merge']`));

  await until(
    () => git(dir, "rev-list", "--count", "--merges", "main") === "1",
    "merge commit created",
  );
  const parents = git(dir, "log", "-1", "--format=%P", "main").split(" ");
  const head = git(dir, "rev-parse", "main");
  if (head === oldMain) throw new Error("main did not move");
  if (parents.length !== 2 || parents[0] !== oldMain || parents[1] !== featureTip) {
    throw new Error(`unexpected merge parents ${parents.join(",")} (feature ${featureTip})`);
  }

  await until(
    async () => (await app.all('[aria-label="Commit graph"] [role="row"]')).length === 4,
    "graph shows merge row",
  );
  await app.screenshot("dnd-merge");
}
