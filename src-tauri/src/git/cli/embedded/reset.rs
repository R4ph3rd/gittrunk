//! `git reset [--merge|--hard|--mixed|--soft] [<rev>]` and
//! `git reset [<rev>] -- <paths>`.

use std::collections::BTreeSet;
use std::path::Path;

use git2::build::CheckoutBuilder;
use git2::{Commit, Oid, Repository, ResetType};

use super::{
    clear_pick_state, fail, move_head, ok, remove_state_file, split_dashdash, unsupported, Ctx, Res,
};
use crate::ipc::error::AppResult;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Mode {
    Soft,
    Mixed,
    Hard,
    Merge,
}

pub fn run(ctx: &Ctx, args: &[String]) -> Res {
    let (flags, paths) = split_dashdash(args);
    let mut mode = Mode::Mixed;
    let mut rev: Option<&str> = None;
    for a in flags {
        match a.as_str() {
            "--soft" => mode = Mode::Soft,
            "--mixed" => mode = Mode::Mixed,
            "--hard" => mode = Mode::Hard,
            "--merge" => mode = Mode::Merge,
            "-q" | "--quiet" => {}
            s if s.starts_with('-') && s.len() > 1 => {
                let mut full = vec!["reset".to_string()];
                full.extend(args.iter().cloned());
                return Ok(unsupported(&full));
            }
            s if rev.is_none() => rev = Some(s),
            _ => {
                let mut full = vec!["reset".to_string()];
                full.extend(args.iter().cloned());
                return Ok(unsupported(&full));
            }
        }
    }
    let repo = ctx.open()?;
    let target: Commit<'_> = match rev {
        Some(r) => match repo.revparse_single(r).and_then(|o| o.peel_to_commit()) {
            Ok(c) => c,
            Err(_) => {
                return Ok(fail(
                    128,
                    &format!("fatal: ambiguous argument '{r}': unknown revision or path not in the working tree."),
                ))
            }
        },
        None => match repo.head().and_then(|h| h.peel_to_commit()) {
            Ok(c) => c,
            Err(_) => return Ok(fail(128, "fatal: Failed to resolve 'HEAD' as a valid ref.")),
        },
    };
    if !paths.is_empty() {
        let list: Vec<String> = paths.iter().map(|p| p.replace('\\', "/")).collect();
        repo.reset_default(Some(target.as_object()), list.iter().map(String::as_str))?;
        return Ok(ok(""));
    }
    reset_to(&repo, &target, mode)?;
    Ok(ok(""))
}

/// Moves HEAD to `target` and resets the index and/or working tree.
pub(super) fn reset_to(repo: &Repository, target: &Commit<'_>, mode: Mode) -> AppResult<()> {
    match mode {
        Mode::Soft => {
            move_head(repo, target.id(), "reset: moving")?;
        }
        Mode::Mixed => {
            repo.reset(target.as_object(), ResetType::Mixed, None)?;
        }
        Mode::Hard => {
            let mut co = CheckoutBuilder::new();
            co.force();
            repo.reset(target.as_object(), ResetType::Hard, Some(&mut co))?;
            clear_merge_state(repo);
        }
        Mode::Merge => {
            reset_merge(repo, target)?;
            clear_merge_state(repo);
        }
    }
    Ok(())
}

/// Removes MERGE_HEAD, MERGE_MSG, CHERRY_PICK_HEAD, ... (not the sequencer).
pub(super) fn clear_merge_state(repo: &Repository) {
    clear_pick_state(repo);
    remove_state_file(repo, "MERGE_HEAD");
    remove_state_file(repo, "SQUASH_MSG");
}

/// `git reset --merge`: puts the index and every file the interrupted
/// operation touched back to `target`, keeping unrelated local edits.
pub(super) fn reset_merge(repo: &Repository, target: &Commit<'_>) -> AppResult<()> {
    let workdir = repo.workdir().map(Path::to_path_buf);
    let target_tree = target.tree()?;
    let mut index = repo.index()?;
    let mut touched: BTreeSet<String> = BTreeSet::new();
    {
        let diff = repo.diff_tree_to_index(Some(&target_tree), Some(&index), None)?;
        for d in diff.deltas() {
            for f in [d.old_file(), d.new_file()] {
                if let Some(p) = f.path() {
                    touched.insert(p.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    for c in index.conflicts()? {
        let c = c?;
        for e in [&c.our, &c.their, &c.ancestor].into_iter().flatten() {
            touched.insert(String::from_utf8_lossy(&e.path).into_owned());
        }
    }
    // Restore what the target has; delete what it does not.
    let mut co = CheckoutBuilder::new();
    co.force().update_index(false);
    let mut restore = false;
    for p in &touched {
        if target_tree.get_path(Path::new(p)).is_ok() {
            co.path(p);
            restore = true;
        } else if let Some(w) = &workdir {
            let _ = std::fs::remove_file(w.join(p));
        }
    }
    if restore {
        repo.checkout_tree(target_tree.as_object(), Some(&mut co))?;
    }
    index.read_tree(&target_tree)?;
    index.write()?;
    let head = repo.head().ok().and_then(|h| h.target());
    if head != Some(target.id()) {
        move_head(repo, target.id(), "reset: moving")?;
    }
    Ok(())
}

/// Parses `oid` for the callers that store hex ids.
pub(super) fn parse_oid(s: &str) -> Option<Oid> {
    Oid::from_str(s.trim()).ok()
}
