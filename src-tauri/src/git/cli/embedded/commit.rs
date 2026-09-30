//! `git commit -F - [--amend] [--allow-empty] [--signoff] [--no-verify]` and
//! `git commit --no-edit` (concluding a merge, cherry-pick or revert).
//!
//! Hooks are never run and commits are never signed: `commit.gpgsign=true`
//! only produces a warning on stderr.

use git2::{Commit, Oid, Repository, RepositoryState, StatusOptions};

use super::{clean_message, clear_pick_state, fail, remove_state_file, unsupported, Ctx, Res};
use crate::ipc::error::AppResult;

#[derive(Default)]
struct Args {
    message: Option<String>,
    amend: bool,
    allow_empty: bool,
    signoff: bool,
    no_edit: bool,
}

pub fn run(ctx: &Ctx, args: &[String]) -> Res {
    let mut a = Args::default();
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "-F" | "--file" => {
                let Some(src) = it.next() else {
                    return Ok(fail(129, "error: switch `F' requires a value"));
                };
                a.message = Some(if src == "-" {
                    String::from_utf8_lossy(ctx.stdin.as_deref().unwrap_or_default()).into_owned()
                } else {
                    match std::fs::read(ctx.dir.join(src)) {
                        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                        Err(e) => {
                            return Ok(fail(
                                128,
                                &format!("fatal: could not read log file '{src}': {e}"),
                            ))
                        }
                    }
                });
            }
            "-m" | "--message" => {
                let Some(m) = it.next() else {
                    return Ok(fail(129, "error: switch `m' requires a value"));
                };
                match &mut a.message {
                    Some(prev) => {
                        prev.push_str("\n\n");
                        prev.push_str(m);
                    }
                    None => a.message = Some(m.clone()),
                }
            }
            "--amend" => a.amend = true,
            "--allow-empty" => a.allow_empty = true,
            "-s" | "--signoff" => a.signoff = true,
            "--no-edit" => a.no_edit = true,
            "-n"
            | "--no-verify"
            | "-q"
            | "--quiet"
            | "--no-gpg-sign"
            | "--no-status"
            | "--allow-empty-message" => {}
            _ => {
                let mut full = vec!["commit".to_string()];
                full.extend(args.iter().cloned());
                return Ok(unsupported(&full));
            }
        }
    }

    let repo = ctx.open()?;
    if repo.is_bare() {
        return Ok(fail(
            128,
            "fatal: this operation must be run in a work tree",
        ));
    }
    let mut warnings = String::new();
    if ctx.config_bool(&repo, "commit.gpgsign") {
        warnings.push_str(
            "warning: commit.gpgsign is set but signing is not supported on this platform; the commit is unsigned\n",
        );
    }

    let state = repo.state();
    let head_commit: Option<Commit<'_>> = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    if a.amend && head_commit.is_none() {
        return Ok(fail(128, "fatal: You have nothing to amend."));
    }

    let mut index = repo.index()?;
    // Pick up changes made by other processes since the index was cached.
    index.read(true)?;
    if index.has_conflicts() {
        return Ok(fail(
            128,
            "error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.",
        ));
    }

    // Message.
    let merge_msg = repo.message().ok();
    let raw = match (&a.message, a.no_edit, &merge_msg, &head_commit) {
        (Some(m), _, _, _) => clean_message(m, false),
        (None, true, Some(m), _) => clean_message(m, true),
        (None, true, None, Some(h)) if a.amend => h.message().ok().unwrap_or_default().to_string(),
        _ => String::new(),
    };
    let mut message = raw;
    if message.trim().is_empty() {
        return Ok(fail(1, "Aborting commit due to empty commit message."));
    }

    let committer = match ctx.committer(&repo) {
        Ok(s) => s,
        Err(out) => return Ok(out),
    };
    let default_author = match ctx.author(&repo) {
        Ok(s) => s,
        Err(out) => return Ok(out),
    };
    if a.signoff {
        let trailer = format!(
            "Signed-off-by: {} <{}>",
            committer.name().unwrap_or_default(),
            committer.email().unwrap_or_default()
        );
        let last = message.trim_end().lines().last().unwrap_or_default();
        if last != trailer {
            if last.starts_with("Signed-off-by:") {
                message = format!("{}\n{trailer}\n", message.trim_end());
            } else {
                message = format!("{}\n\n{trailer}\n", message.trim_end());
            }
        }
    }

    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let summary = message.lines().next().unwrap_or_default().to_string();

    // Extra parents of a merge in progress.
    let merging = state == RepositoryState::Merge;
    let mut merge_heads: Vec<Oid> = Vec::new();
    if merging {
        let text =
            std::fs::read_to_string(super::git_file(&repo, "MERGE_HEAD")).unwrap_or_default();
        merge_heads.extend(text.lines().filter_map(|l| Oid::from_str(l.trim()).ok()));
    }
    let pick_author =
        if state == RepositoryState::CherryPick || state == RepositoryState::CherryPickSequence {
            cherry_pick_head(&repo)
        } else {
            None
        };

    let head_tree_id = head_commit.as_ref().map(Commit::tree_id);
    let same_as_head = match head_tree_id {
        Some(h) => h == tree_id,
        None => tree.is_empty(),
    };
    if !a.allow_empty && !a.amend && !merging && same_as_head {
        return nothing_to_commit(&repo, warnings);
    }

    let new_id = if a.amend {
        let old = head_commit.as_ref().ok_or_else(|| {
            crate::ipc::error::AppError::new(
                crate::ipc::error::ErrorKind::Internal,
                "no commit to amend",
            )
        })?;
        old.amend(
            Some("HEAD"),
            None,
            Some(&committer),
            None,
            Some(&message),
            Some(&tree),
        )?
    } else {
        let author = pick_author.unwrap_or(default_author);
        let mut parents: Vec<Commit<'_>> = Vec::new();
        if let Some(h) = &head_commit {
            parents.push(h.clone());
        }
        for oid in &merge_heads {
            parents.push(repo.find_commit(*oid)?);
        }
        let refs: Vec<&Commit<'_>> = parents.iter().collect();
        repo.commit(Some("HEAD"), &author, &committer, &message, &tree, &refs)?
    };

    match state {
        RepositoryState::Merge => repo.cleanup_state()?,
        _ => clear_pick_state(&repo),
    }
    remove_state_file(&repo, "SQUASH_MSG");

    let branch = match repo.head() {
        Ok(h) if h.is_branch() => h.shorthand().ok().unwrap_or("HEAD").to_string(),
        _ => "detached HEAD".to_string(),
    };
    let root = if head_commit.is_none() && !a.amend {
        " (root-commit)"
    } else {
        ""
    };
    let short = &new_id.to_string()[..7];
    Ok(super::CliOutput {
        stdout: format!("[{branch}{root} {short}] {summary}\n").into_bytes(),
        stderr: warnings,
        code: 0,
    })
}

/// Author of the commit named by CHERRY_PICK_HEAD, if any.
fn cherry_pick_head(repo: &Repository) -> Option<git2::Signature<'static>> {
    let text = std::fs::read_to_string(super::git_file(repo, "CHERRY_PICK_HEAD")).ok()?;
    let oid = Oid::from_str(text.trim()).ok()?;
    let c = repo.find_commit(oid).ok()?;
    let a = c.author();
    git2::Signature::new(
        a.name().ok().unwrap_or_default(),
        a.email().ok().unwrap_or_default(),
        &a.when(),
    )
    .ok()
}

/// git's "nothing to commit" report (stdout, exit 1).
fn nothing_to_commit(repo: &Repository, warnings: String) -> AppResult<super::CliOutput> {
    let branch = match repo.head() {
        Ok(h) if h.is_branch() => format!("On branch {}\n", h.shorthand().ok().unwrap_or("HEAD")),
        _ => "HEAD detached\n".to_string(),
    };
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    let tracked_dirty = statuses
        .iter()
        .any(|e| !e.status().is_empty() && !e.status().is_wt_new() && !e.status().is_ignored());
    let untracked = statuses.iter().any(|e| e.status().is_wt_new());
    let tail = if tracked_dirty {
        "no changes added to commit (use \"git add\" and/or \"git commit -a\")\n"
    } else if untracked {
        "nothing added to commit but untracked files present (use \"git add\" to track)\n"
    } else {
        "nothing to commit, working tree clean\n"
    };
    Ok(super::CliOutput {
        stdout: format!("{branch}{tail}").into_bytes(),
        stderr: warnings,
        code: 1,
    })
}
