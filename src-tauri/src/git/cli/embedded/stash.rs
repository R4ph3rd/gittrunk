//! `git stash push|store|apply|pop|drop` on the libgit2 stash API.

use std::cell::RefCell;
use std::rc::Rc;

use git2::build::CheckoutBuilder;
use git2::{Oid, Repository, StashApplyOptions, StashFlags, StashSaveOptions};

use super::{conflict_lines, fail, ok, overwritten_message, split_dashdash, unsupported, Ctx, Res};
use crate::ipc::error::AppResult;

pub fn run(ctx: &Ctx, args: &[String]) -> Res {
    let (sub, rest) = match args.first().map(String::as_str) {
        Some(s) if !s.starts_with('-') => (s, &args[1..]),
        // `git stash -u ...` is `git stash push -u ...`.
        _ => ("push", args),
    };
    match sub {
        "push" | "save" => push(ctx, rest),
        "store" => store(ctx, rest),
        "apply" => apply(ctx, rest, false),
        "pop" => apply(ctx, rest, true),
        "drop" => drop_entry(ctx, rest),
        _ => {
            let mut full = vec!["stash".to_string()];
            full.extend(args.iter().cloned());
            Ok(unsupported(&full))
        }
    }
}

fn unsupported_stash(sub: &str, args: &[String]) -> super::CliOutput {
    let mut full = vec!["stash".to_string(), sub.to_string()];
    full.extend(args.iter().cloned());
    unsupported(&full)
}

fn push(ctx: &Ctx, args: &[String]) -> Res {
    let (flags, paths) = split_dashdash(args);
    let mut include_untracked = false;
    let mut keep_index = false;
    let mut message: Option<String> = None;
    let mut it = flags.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-u" | "--include-untracked" => include_untracked = true,
            "-k" | "--keep-index" => keep_index = true,
            "-q" | "--quiet" => {}
            "-m" | "--message" => match it.next() {
                Some(m) => message = Some(m.clone()),
                None => return Ok(fail(129, "error: switch `m' requires a value")),
            },
            _ => return Ok(unsupported_stash("push", args)),
        }
    }
    let mut repo = ctx.open()?;
    if repo.head().is_err() {
        return Ok(fail(1, "You do not have the initial commit yet"));
    }
    let stasher = match ctx.committer(&repo) {
        Ok(s) => s,
        Err(out) => return Ok(out),
    };
    let mut sflags = StashFlags::DEFAULT;
    if include_untracked {
        sflags |= StashFlags::INCLUDE_UNTRACKED;
    }
    if keep_index {
        sflags |= StashFlags::KEEP_INDEX;
    }
    let result = if paths.is_empty() {
        repo.stash_save2(&stasher, message.as_deref(), Some(sflags))
    } else if message.is_some() {
        // libgit2 cannot combine a pathspec with a custom message.
        return Ok(unsupported_stash("push", args));
    } else {
        let mut opts = StashSaveOptions::new(stasher);
        opts.flags(Some(sflags));
        for p in paths {
            opts.pathspec(p.replace('\\', "/"));
        }
        repo.stash_save_ext(Some(&mut opts))
    };
    match result {
        Ok(oid) => {
            let summary = repo
                .find_commit(oid)?
                .message()
                .ok()
                .and_then(|m| m.lines().next())
                .unwrap_or_default()
                .to_string();
            Ok(ok(format!(
                "Saved working directory and index state {summary}\n"
            )))
        }
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(ok("No local changes to save\n")),
        Err(e) => Err(e.into()),
    }
}

fn store(ctx: &Ctx, args: &[String]) -> Res {
    let mut message: Option<String> = None;
    let mut oid: Option<&str> = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-q" | "--quiet" => {}
            "-m" | "--message" => match it.next() {
                Some(m) => message = Some(m.clone()),
                None => return Ok(fail(129, "error: switch `m' requires a value")),
            },
            s if s.starts_with('-') => return Ok(unsupported_stash("store", args)),
            s => oid = Some(s),
        }
    }
    let Some(oid) = oid else {
        return Ok(fail(
            1,
            "\"git stash store\" requires one <commit> argument",
        ));
    };
    let repo = ctx.open()?;
    let Some(commit) = Oid::from_str(oid)
        .ok()
        .and_then(|o| repo.find_commit(o).ok())
        .or_else(|| {
            repo.revparse_single(oid)
                .ok()
                .and_then(|o| o.peel_to_commit().ok())
        })
    else {
        return Ok(fail(1, &format!("fatal: not a valid object name: '{oid}'")));
    };
    let message = message.unwrap_or_else(|| "Created via \"git stash store\".".to_string());
    // The stash list is the reflog of refs/stash: make sure it exists so the
    // update below records the entry.
    repo.reference_ensure_log("refs/stash")?;
    repo.reference("refs/stash", commit.id(), true, &message)?;
    Ok(ok(""))
}

/// Parses `stash@{n}` (or nothing: 0).
fn parse_index(arg: Option<&String>) -> Option<usize> {
    let Some(a) = arg else { return Some(0) };
    let inner = a.strip_prefix("stash@{")?.strip_suffix('}')?;
    inner.parse().ok()
}

/// Commit id and message of stash entry `n`.
fn entry(repo: &mut Repository, n: usize) -> AppResult<Option<(Oid, String)>> {
    let mut found = None;
    repo.stash_foreach(|i, msg, oid| {
        if i == n {
            found = Some((*oid, msg.to_string()));
            false
        } else {
            true
        }
    })
    .or_else(|e| {
        // Stopping the iteration early is reported as a user error.
        if found.is_some() {
            Ok(())
        } else {
            Err(e)
        }
    })?;
    Ok(found)
}

fn apply(ctx: &Ctx, args: &[String], pop: bool) -> Res {
    let verb = if pop { "pop" } else { "apply" };
    let mut reinstate_index = false;
    let mut name: Option<&String> = None;
    for a in args {
        match a.as_str() {
            "--index" => reinstate_index = true,
            "-q" | "--quiet" => {}
            s if s.starts_with('-') => return Ok(unsupported_stash(verb, args)),
            _ => name = Some(a),
        }
    }
    let Some(n) = parse_index(name) else {
        return Ok(fail(
            1,
            &format!(
                "error: {} is not a valid reference",
                name.map_or("", String::as_str)
            ),
        ));
    };
    let mut repo = ctx.open()?;
    let Some((oid, _)) = entry(&mut repo, n)? else {
        return Ok(fail(
            1,
            &format!("error: stash@{{{n}}} is not a valid reference"),
        ));
    };

    let refused = Rc::new(RefCell::new(Vec::<String>::new()));
    let mut co = CheckoutBuilder::new();
    co.safe();
    co.notify_on(git2::CheckoutNotificationType::CONFLICT);
    {
        let refused = Rc::clone(&refused);
        co.notify(move |_, path, _, _, _| {
            if let Some(p) = path {
                refused
                    .borrow_mut()
                    .push(p.to_string_lossy().replace('\\', "/"));
            }
            true
        });
    }
    let mut opts = StashApplyOptions::new();
    if reinstate_index {
        opts.reinstantiate_index();
    }
    opts.checkout_options(co);
    match repo.stash_apply(n, Some(&mut opts)) {
        Ok(()) => {}
        Err(e) if e.code() == git2::ErrorCode::Uncommitted => {
            return Ok(fail(
                1,
                "error: Cannot apply stash: your index contains uncommitted changes.\nThe stash entry is kept in case you need it again.",
            ));
        }
        Err(e)
            if matches!(
                e.code(),
                git2::ErrorCode::Conflict | git2::ErrorCode::MergeConflict
            ) =>
        {
            let files = refused.borrow().clone();
            let mut msg = overwritten_message(&files, "merge", "merge");
            msg.push_str("\nThe stash entry is kept in case you need it again.");
            return Ok(fail(1, &msg));
        }
        Err(e) => return Err(e.into()),
    }
    drop(opts);

    let mut index = repo.index()?;
    index.read(true)?;
    if index.has_conflicts() {
        let lines = conflict_lines(&index, "Stashed changes")?;
        return Ok(super::CliOutput {
            stdout: Vec::new(),
            stderr: format!("{lines}\nThe stash entry is kept in case you need it again.\n"),
            code: 1,
        });
    }
    if pop {
        repo.stash_drop(n)?;
        Ok(ok(format!("Dropped refs/stash@{{{n}}} ({oid})\n")))
    } else {
        Ok(ok(""))
    }
}

fn drop_entry(ctx: &Ctx, args: &[String]) -> Res {
    let mut name: Option<&String> = None;
    for a in args {
        match a.as_str() {
            "-q" | "--quiet" => {}
            s if s.starts_with('-') => return Ok(unsupported_stash("drop", args)),
            _ => name = Some(a),
        }
    }
    let Some(n) = parse_index(name) else {
        return Ok(fail(
            1,
            &format!(
                "error: {} is not a valid reference",
                name.map_or("", String::as_str)
            ),
        ));
    };
    let mut repo = ctx.open()?;
    let Some((oid, _)) = entry(&mut repo, n)? else {
        return Ok(fail(
            1,
            &format!("error: stash@{{{n}}} is not a valid reference"),
        ));
    };
    repo.stash_drop(n)?;
    Ok(ok(format!("Dropped refs/stash@{{{n}}} ({oid})\n")))
}
