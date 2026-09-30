//! `git merge [--no-edit] [--no-ff|--ff-only|--squash] [-m <msg>] [--] <rev>`
//! and `git merge --abort`.

use std::cell::RefCell;
use std::rc::Rc;

use git2::build::CheckoutBuilder;
use git2::{Commit, MergeOptions, Oid, Repository, RepositoryState};

use super::reset::reset_merge;
use super::{
    checkout_safe, clean_message, conflict_lines, fail, git_file, move_head, ok,
    overwritten_message, remove_state_file, split_dashdash, unsupported, CliOutput, Ctx, Res,
};

pub fn run(ctx: &Ctx, args: &[String]) -> Res {
    let (flags, after) = split_dashdash(args);
    let mut no_ff = false;
    let mut ff_only = false;
    let mut squash = false;
    let mut abort = false;
    let mut message: Option<String> = None;
    let mut revs: Vec<&String> = after.iter().collect();
    let mut it = flags.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--no-edit" | "--edit" | "-e" | "-q" | "--quiet" | "--no-verify" | "--ff"
            | "--no-stat" | "--stat" | "--no-progress" => {}
            "--no-ff" => no_ff = true,
            "--ff-only" => ff_only = true,
            "--squash" => squash = true,
            "--abort" => abort = true,
            "-m" | "--message" => match it.next() {
                Some(m) => message = Some(m.clone()),
                None => return Ok(fail(129, "error: switch `m' requires a value")),
            },
            s if s.starts_with('-') && s.len() > 1 => {
                let mut full = vec!["merge".to_string()];
                full.extend(args.iter().cloned());
                return Ok(unsupported(&full));
            }
            _ => revs.push(a),
        }
    }
    let repo = ctx.open()?;
    if abort {
        return abort_merge(&repo);
    }
    let [rev] = revs.as_slice() else {
        let mut full = vec!["merge".to_string()];
        full.extend(args.iter().cloned());
        return Ok(if revs.is_empty() {
            fail(1, "fatal: No remote for the current branch.")
        } else {
            unsupported(&full)
        });
    };
    let rev = rev.as_str();

    if repo.state() == RepositoryState::Merge {
        return Ok(fail(
            128,
            "error: You have not concluded your merge (MERGE_HEAD exists).\nhint: Please, commit your changes before you merge.\nfatal: Exiting because of unfinished merge.",
        ));
    }
    let Ok(head) = repo.head().and_then(|h| h.peel_to_commit()) else {
        return Ok(fail(128, "fatal: cannot merge into an unborn branch"));
    };

    // The merge source, keeping its reference for the default message.
    let (obj, reference) = match repo.revparse_ext(rev) {
        Ok(v) => v,
        Err(_) => {
            return Ok(fail(
                1,
                &format!("merge: {rev} - not something we can merge"),
            ));
        }
    };
    let Ok(theirs) = obj.peel_to_commit() else {
        return Ok(fail(
            1,
            &format!("merge: {rev} - not something we can merge"),
        ));
    };
    let annotated = match &reference {
        Some(r) => repo.reference_to_annotated_commit(r)?,
        None => repo.find_annotated_commit(theirs.id())?,
    };
    let label = source_label(reference.as_ref(), rev);
    let default_message = {
        let cur = if head_is_branch(&repo) {
            repo.head()?.shorthand().ok().map(str::to_string)
        } else {
            None
        };
        match cur {
            Some(c) if c != "main" && c != "master" => format!("Merge {label} into {c}\n"),
            _ => format!("Merge {label}\n"),
        }
    };
    let final_message = match &message {
        Some(m) if !m.trim().is_empty() => clean_message(m, false),
        _ => default_message,
    };

    let (analysis, _) = repo.merge_analysis(&[&annotated])?;
    if analysis.is_up_to_date() {
        return Ok(ok("Already up to date.\n"));
    }
    if !squash && analysis.is_fast_forward() && !no_ff {
        return fast_forward(&repo, &head, &theirs);
    }
    if ff_only && !squash {
        return Ok(fail(
            128,
            "hint: Diverging branches can't be fast-forwarded.\nfatal: Not possible to fast-forward, aborting.",
        ));
    }

    // Three-way merge.
    let refused = Rc::new(RefCell::new(Vec::<String>::new()));
    let mut co = CheckoutBuilder::new();
    co.conflict_style_merge(true);
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
    let mut mo = MergeOptions::new();
    let merged = repo.merge(&[&annotated], Some(&mut mo), Some(&mut co));
    if let Err(e) = merged {
        // Nothing was written when the pre-checks refuse; stale state files
        // of a half-started merge must not linger.
        remove_state_file(&repo, "MERGE_HEAD");
        remove_state_file(&repo, "MERGE_MODE");
        remove_state_file(&repo, "MERGE_MSG");
        return if matches!(
            e.code(),
            git2::ErrorCode::Conflict
                | git2::ErrorCode::MergeConflict
                | git2::ErrorCode::Uncommitted
        ) {
            let files = refused.borrow().clone();
            Ok(fail(1, &refusal(&files)))
        } else {
            Err(e.into())
        };
    }
    drop(co);

    let mut index = repo.index()?;
    if squash {
        remove_state_file(&repo, "MERGE_HEAD");
        remove_state_file(&repo, "MERGE_MODE");
        remove_state_file(&repo, "MERGE_MSG");
        if index.has_conflicts() {
            let lines = conflict_lines(&index, &label)?;
            return Ok(CliOutput {
                stdout: format!(
                    "{lines}\nSquash commit -- not updating HEAD\nAutomatic merge failed; fix conflicts and then commit the result.\n"
                )
                .into_bytes(),
                stderr: String::new(),
                code: 1,
            });
        }
        std::fs::write(
            git_file(&repo, "SQUASH_MSG"),
            squash_message(&repo, &head, &theirs)?,
        )?;
        return Ok(ok("Squash commit -- not updating HEAD\n"));
    }

    if index.has_conflicts() {
        // git's own MERGE_MSG: what `commit --no-edit` will use.
        std::fs::write(git_file(&repo, "MERGE_MSG"), &final_message)?;
        let lines = conflict_lines(&index, &label)?;
        return Ok(CliOutput {
            stdout: format!(
                "{lines}\nAutomatic merge failed; fix conflicts and then commit the result.\n"
            )
            .into_bytes(),
            stderr: String::new(),
            code: 1,
        });
    }

    let author = match ctx.author(&repo) {
        Ok(s) => s,
        Err(out) => {
            let _ = repo.cleanup_state();
            return Ok(out);
        }
    };
    let committer = match ctx.committer(&repo) {
        Ok(s) => s,
        Err(out) => {
            let _ = repo.cleanup_state();
            return Ok(out);
        }
    };
    let tree = repo.find_tree(index.write_tree()?)?;
    repo.commit(
        Some("HEAD"),
        &author,
        &committer,
        &final_message,
        &tree,
        &[&head, &theirs],
    )?;
    repo.cleanup_state()?;
    Ok(ok("Merge made by the 'ort' strategy.\n"))
}

fn refusal(files: &[String]) -> String {
    if files.is_empty() {
        "error: Your local changes would be overwritten by merge.\nPlease commit your changes or stash them before you merge.\nAborting".to_string()
    } else {
        overwritten_message(files, "merge", "merge")
    }
}

fn head_is_branch(repo: &Repository) -> bool {
    repo.head().is_ok_and(|h| h.is_branch())
}

/// `branch 'x'`, `remote-tracking branch 'origin/x'`, `tag 'v1'` or
/// `commit '<rev>'`, as git words the default merge message.
fn source_label(reference: Option<&git2::Reference<'_>>, rev: &str) -> String {
    if let Some(r) = reference {
        if let (Ok(name), Ok(short)) = (r.name(), r.shorthand()) {
            if let Some(n) = name.strip_prefix("refs/heads/") {
                return format!("branch '{n}'");
            }
            if let Some(n) = name.strip_prefix("refs/remotes/") {
                return format!("remote-tracking branch '{n}'");
            }
            if name.starts_with("refs/tags/") {
                return format!("tag '{short}'");
            }
        }
    }
    format!("commit '{rev}'")
}

fn fast_forward(repo: &Repository, head: &Commit<'_>, theirs: &Commit<'_>) -> Res {
    let tree = theirs.tree()?;
    if let Err(files) = checkout_safe(repo, tree.as_object())? {
        return Ok(fail(1, &refusal(&files)));
    }
    move_head(
        repo,
        theirs.id(),
        &format!("merge {}: Fast-forward", theirs.id()),
    )?;
    Ok(ok(format!(
        "Updating {}..{}\nFast-forward\n",
        &head.id().to_string()[..7],
        &theirs.id().to_string()[..7]
    )))
}

fn abort_merge(repo: &Repository) -> Res {
    if !git_file(repo, "MERGE_HEAD").exists() {
        return Ok(fail(
            128,
            "fatal: There is no merge to abort (MERGE_HEAD missing).",
        ));
    }
    let head = repo.head()?.peel_to_commit()?;
    reset_merge(repo, &head)?;
    repo.cleanup_state()?;
    Ok(ok(""))
}

/// Text git keeps in SQUASH_MSG: the commits being squashed.
fn squash_message(
    repo: &Repository,
    head: &Commit<'_>,
    theirs: &Commit<'_>,
) -> super::AppResult<String> {
    let mut walk = repo.revwalk()?;
    walk.push(theirs.id())?;
    walk.hide(head.id())?;
    let ids: Vec<Oid> = walk.collect::<Result<_, _>>()?;
    let mut s = String::from("Squashed commit of the following:\n");
    for id in ids {
        let c = repo.find_commit(id)?;
        let a = c.author();
        s.push_str(&format!(
            "\ncommit {id}\nAuthor: {} <{}>\n\n",
            a.name().ok().unwrap_or_default(),
            a.email().ok().unwrap_or_default()
        ));
        for line in c.message().ok().unwrap_or_default().lines() {
            s.push_str(&format!("    {line}\n"));
        }
    }
    Ok(s)
}
