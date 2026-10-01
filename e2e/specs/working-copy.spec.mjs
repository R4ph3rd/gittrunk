import { git, until } from "../lib.mjs";
import { workingCopyWithRemote } from "../fixtures.mjs";

export const name = "stages, commits, pushes and undoes through the UI";

export async function run(app, root) {
  const { dir, remote } = workingCopyWithRemote(root);
  await app.openRepo(dir);

  await app.click(await app.xpath("//*[contains(text(), '// WIP')]"));
  await app.css('[aria-label="Working copy"]');

  await app.click(await app.xpath("//button[normalize-space()='Stage all']"));
  await until(() => git(dir, "diff", "--cached", "--name-only") === "a.txt\nb.txt", "stage all");

  await app.type(await app.css('input[placeholder="Commit summary"]'), "add b and extend a");
  // Scoped: the right panel's "Commit" tab is a button too.
  await app.click(
    await app.xpath("//*[@aria-label='Working copy']//button[normalize-space()='Commit']"),
  );
  await until(() => git(dir, "log", "-1", "--format=%s") === "add b and extend a", "commit");

  await app.click(
    await app.xpath("//button[contains(normalize-space(), 'Push') and not(@aria-label)]"),
  );
  await until(
    () => git(remote, "log", "-1", "--format=%s", "main") === "add b and extend a",
    "push to bare remote",
    20_000,
  );

  const previous = git(dir, "rev-parse", "HEAD~1");
  await app.chord(["Control", "z"]);
  await app.click(await app.xpath("//*[@role='alertdialog']//button[normalize-space()='Undo']"));
  await until(() => git(dir, "rev-parse", "HEAD") === previous, "undo commit");
  await app.screenshot("working-copy");
}
