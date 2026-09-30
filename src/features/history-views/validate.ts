export interface WorktreeForm {
  path: string;
  branch: string;
  createBranch: boolean;
}

export interface WorktreeErrors {
  path?: string;
  branch?: string;
}

// Same rules as `git check-ref-format` for the parts users actually trip over.
const BAD_REF_CHARS = /[\s~^:?*[\\]/;

export function validateBranchName(name: string): string | undefined {
  if (name.startsWith("-")) return "A branch name cannot start with a dash.";
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
    return "A branch name cannot start or end with a slash, or contain empty parts.";
  }
  if (name.endsWith(".") || name.endsWith(".lock") || name.includes("..") || name.includes("@{")) {
    return "This is not a valid branch name.";
  }
  if (BAD_REF_CHARS.test(name)) return "A branch name cannot contain spaces or ~ ^ : ? * [ \\.";
  return undefined;
}

/** Validates the "Add worktree" form. `localBranches` are short names of existing local branches. */
export function validateWorktree(form: WorktreeForm, localBranches: string[]): WorktreeErrors {
  const errors: WorktreeErrors = {};
  const path = form.path.trim();
  const branch = form.branch.trim();
  if (!path) errors.path = "Choose a folder for the worktree.";
  if (!branch) {
    errors.branch = form.createBranch ? "Enter a name for the new branch." : "Enter a branch.";
  } else if (form.createBranch) {
    errors.branch =
      validateBranchName(branch) ??
      (localBranches.includes(branch) ? `Branch ${branch} already exists.` : undefined);
  } else if (!localBranches.includes(branch)) {
    errors.branch = `Branch ${branch} does not exist. Turn on "Create new branch" to create it.`;
  }
  if (!errors.path) delete errors.path;
  if (!errors.branch) delete errors.branch;
  return errors;
}
