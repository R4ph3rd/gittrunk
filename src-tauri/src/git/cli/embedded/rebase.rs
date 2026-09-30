//! `git rebase <upstream> [<branch>]`, `git rebase --onto <newbase>
//! <upstream> [<branch>]` and `git rebase --continue | --abort | --skip`,
//! on libgit2's on-disk (non in-memory) rebase so `repo.state()` reports a
//! rebase while it is stopped. Interactive rebase (`-i`, `--exec`,
//! `GIT_SEQUENCE_EDITOR` flows) stays unsupported.
//!
//! Known divergences from git: commits whose patch is already upstream are
//! detected only when replaying yields an empty change (they are then
//! dropped like git's patch-id skipping); merge commits in the range are not
//! linearised; no autostash.

use std::fs;

use git2::{ErrorCode, Repository, StatusOptions};

use super::{
    conflict_lines, fail, git_file, move_head, ok, remove_state_file, staged_changes, unsupported,
    AppResult, CliOutput, Ctx, Res,
};

enum Control {
    Continue,
    Abort,
    Skip,
}

pub fn run(ctx: &Ctx, args: &[String]) -> Res {
    let mut control: Option<Control> = None;
    let mut onto: Option<&String> = None;
    let mut pos: Vec<&String> = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-q" | "--quiet" | "-m" | "--merge" | "--no-autostash" | "--no-verify" => {}
            "--continue" => control = Some(Control::Continue),
            "--abort" => control = Some(Control::Abort),
            "--skip" => control = Some(Control::Skip),
            "--onto" => match it.next() {
                Some(v) => onto = Some(v),
                None => return Ok(fail(129, "error: switch `onto' requires a value")),
            },
            s if s.starts_with('-') && s.len() > 1 => {
                let mut full = vec!["rebase".to_string()];
                full.extend(args.iter().cloned());
                return Ok(unsupported(&full));
            }
            _ => pos.push(a),
        }
    }
    let repo = ctx.open()?;
    if let Some(c) = control {
        return control_op(ctx, &repo, c);
    }
    start(ctx, &repo, onto, &pos)
}

fn in_rebase(repo: &Repository) -> bool {
    git_file(repo, "rebase-merge").is_dir() || git_file(repo, "rebase-apply").is_dir()
}

fn short(oid: git2::Oid) -> String {
    oid.to_string()[..7].to_string()
}

fn dirty_tracked(repo: &Repository) -> AppResult<bool> {
    let mut o = StatusOptions::new();
    o.include_untracked(false).include_ignored(false);
    let statuses = repo.statuses(Some(&mut o))?;
    Ok(statuses.iter().any(|s| {
        !s.status()
            .intersects(git2::Status::IGNORED | git2::Status::WT_NEW)
    }))
}

fn start(ctx: &Ctx, repo: &Repository, onto: Option<&String>, pos: &[&String]) -> Res {
    if in_rebase(repo) {
        return Ok(fail(
            128,
            "fatal: It seems that there is already a rebase-merge directory, and\nI wonder if you are in the middle of another rebase.  If that is the\ncase, please try\n\tgit rebase (--continue | --abort | --skip)",
        ));
    }
    let Some(upstream_spec) = pos.first() else {
        return Ok(fail(
            1,
            "There is no tracking information for the current branch.\nPlease specify which branch you want to rebase against.",
        ));
    };
    if pos.len() > 2 {
        return Ok(fail(129, "error: too many arguments"));
    }
    let resolve = |spec: &str| -> Result<git2::Oid, CliOutput> {
        repo.revparse_single(spec)
            .and_then(|o| o.peel_to_commit())
            .map(|c| c.id())
            .map_err(|_| fail(128, &format!("fatal: invalid upstream '{spec}'")))
    };
    let upstream = match resolve(upstream_spec) {
        Ok(o) => o,
        Err(out) => return Ok(out),
    };
    let new_base = match onto {
        Some(spec) => match resolve(spec) {
            Ok(o) => Some(o),
            Err(out) => return Ok(out),
        },
        None => None,
    };
    if repo.is_bare() {
        return Ok(fail(
            128,
            "fatal: this operation must be run in a work tree",
        ));
    }
    if dirty_tracked(repo)? || staged_changes(repo)? {
        return Ok(fail(
            1,
            "error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.",
        ));
    }
    let committer = match ctx.committer(repo) {
        Ok(s) => s,
        Err(out) => return Ok(out),
    };

    // `git rebase <upstream> <branch>` switches to <branch> first.
    if let Some(b) = pos.get(1) {
        let full = format!("refs/heads/{b}");
        let target = if repo.find_reference(&full).is_ok() {
            Some(full)
        } else {
            None
        };
        let obj = match repo.revparse_single(b) {
            Ok(o) => o,
            Err(_) => return Ok(fail(128, &format!("fatal: no such branch/commit '{b}'"))),
        };
        let commit = obj.peel_to_commit()?;
        if let Err(files) = super::checkout_safe(repo, commit.as_object())? {
            return Ok(fail(
                1,
                &super::overwritten_message(&files, "checkout", "switch branches"),
            ));
        }
        match target {
            Some(name) => repo.set_head(&name)?,
            None => repo.set_head_detached(commit.id())?,
        }
    }

    let Ok(tip) = repo.head().and_then(|h| h.peel_to_commit()).map(|c| c.id()) else {
        return Ok(fail(128, "fatal: no commits yet on the current branch"));
    };
    let label = head_label(repo);
    if new_base.is_none() {
        if tip == upstream || repo.graph_descendant_of(tip, upstream)? {
            return Ok(ok(format!("Current branch {label} is up to date.\n")));
        }
        if repo.graph_descendant_of(upstream, tip)? {
            // Fast-forward.
            let target = repo.find_commit(upstream)?;
            if let Err(files) = super::checkout_safe(repo, target.as_object())? {
                return Ok(fail(
                    1,
                    &super::overwritten_message(&files, "checkout", "switch branches"),
                ));
            }
            move_head(repo, upstream, "rebase (finish): fast-forward")?;
            return Ok(rebased(repo));
        }
    }

    let upstream_ac = repo.find_annotated_commit(upstream)?;
    let onto_ac = match new_base {
        Some(o) => Some(repo.find_annotated_commit(o)?),
        None => None,
    };
    let mut opts = git2::RebaseOptions::new();
    let mut rebase = match repo.rebase(None, Some(&upstream_ac), onto_ac.as_ref(), Some(&mut opts))
    {
        Ok(r) => r,
        Err(e) => return Ok(fail(128, &format!("fatal: {}", e.message()))),
    };
    drive(repo, &mut rebase, &committer)
}

fn head_label(repo: &Repository) -> String {
    match repo.head() {
        Ok(h) if h.is_branch() => h.shorthand().unwrap_or("HEAD").to_string(),
        _ => "HEAD".to_string(),
    }
}

/// The `Successfully rebased ...` line git prints (on stderr).
fn rebased(repo: &Repository) -> CliOutput {
    let name = repo
        .find_reference("HEAD")
        .ok()
        .and_then(|h| h.symbolic_target().ok().flatten().map(str::to_string))
        .unwrap_or_else(|| "HEAD".to_string());
    CliOutput {
        stdout: Vec::new(),
        stderr: format!("Successfully rebased and updated {name}.\n"),
        code: 0,
    }
}

/// Applies the remaining steps; stops at the first conflict.
fn drive(repo: &Repository, rebase: &mut git2::Rebase<'_>, committer: &git2::Signature) -> Res {
    loop {
        let op = match rebase.next() {
            None => break,
            Some(Ok(op)) => op,
            Some(Err(e)) => {
                let _ = rebase.abort();
                remove_state_file(repo, "REBASE_HEAD");
                return Ok(fail(1, &format!("error: could not apply: {}", e.message())));
            }
        };
        let oid = op.id();
        let index = repo.index()?;
        if index.has_conflicts() {
            fs::write(git_file(repo, "REBASE_HEAD"), format!("{oid}\n"))?;
            let summary = repo
                .find_commit(oid)
                .ok()
                .and_then(|c| c.summary().ok().flatten().map(str::to_string))
                .unwrap_or_default();
            let lines = conflict_lines(&index, &format!("{} ({summary})", short(oid)))?;
            let s = short(oid);
            return Ok(CliOutput {
                stdout: format!("{lines}\n").into_bytes(),
                stderr: format!(
                    "error: could not apply {s}... {summary}\nhint: Resolve all conflicts manually, mark them as resolved with\nhint: \"git add/rm <conflicted_files>\", then run \"git rebase --continue\".\nhint: You can instead skip this commit: run \"git rebase --skip\".\nhint: To abort and get back to the state before \"git rebase\", run \"git rebase --abort\".\nCould not apply {s}... {summary}\n"
                ),
                code: 1,
            });
        }
        match rebase.commit(None, committer, None) {
            Ok(_) => {}
            // The change is already upstream: git drops such commits.
            Err(e) if e.code() == ErrorCode::Applied => {}
            Err(e) => return Err(e.into()),
        }
    }
    rebase.finish(Some(committer))?;
    remove_state_file(repo, "REBASE_HEAD");
    Ok(rebased(repo))
}

fn control_op(ctx: &Ctx, repo: &Repository, control: Control) -> Res {
    if !in_rebase(repo) {
        return Ok(fail(128, "fatal: No rebase in progress?"));
    }
    let mut rebase = match repo.open_rebase(None) {
        Ok(r) => r,
        Err(e) => return Ok(fail(128, &format!("fatal: {}", e.message()))),
    };
    match control {
        Control::Abort => {
            rebase.abort()?;
            remove_state_file(repo, "REBASE_HEAD");
            Ok(ok(""))
        }
        Control::Skip => {
            let committer = match ctx.committer(repo) {
                Ok(s) => s,
                Err(out) => return Ok(out),
            };
            let head = repo.head()?.peel_to_commit()?;
            discard_step(repo, &head)?;
            remove_state_file(repo, "REBASE_HEAD");
            drive(repo, &mut rebase, &committer)
        }
        Control::Continue => {
            let committer = match ctx.committer(repo) {
                Ok(s) => s,
                Err(out) => return Ok(out),
            };
            if repo.index()?.has_conflicts() {
                return Ok(fail(
                    1,
                    "error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nYou must edit all merge conflicts and then\nmark them as resolved using git add",
                ));
            }
            if rebase.operation_current().is_some() {
                match rebase.commit(None, &committer, None) {
                    Ok(_) => {}
                    Err(e) if e.code() == ErrorCode::Applied => {}
                    Err(e) => return Err(e.into()),
                }
            }
            remove_state_file(repo, "REBASE_HEAD");
            drive(repo, &mut rebase, &committer)
        }
    }
}

/// `reset --hard HEAD` that keeps the rebase state directory (libgit2's own
/// hard reset cleans it up): restores tracked files and drops files the
/// discarded step added.
fn discard_step(repo: &Repository, head: &git2::Commit<'_>) -> AppResult<()> {
    let tree = head.tree()?;
    let mut index = repo.index()?;
    if let Some(workdir) = repo.workdir() {
        for entry in index.iter() {
            let path = String::from_utf8_lossy(&entry.path).into_owned();
            if tree.get_path(std::path::Path::new(&path)).is_err() {
                let _ = fs::remove_file(workdir.join(&path));
            }
        }
    }
    index.read_tree(&tree)?;
    index.write()?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))?;
    Ok(())
}

#[cfg(test)]
#[path = "tests_advanced.rs"]
mod tests_advanced;
