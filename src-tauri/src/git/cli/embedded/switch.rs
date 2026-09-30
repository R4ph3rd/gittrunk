//! `git switch [--detach] [-c <new>] <branch> | <rev>`.

use git2::BranchType;

use super::{checkout_safe, fail, overwritten_message, split_dashdash, unsupported, Ctx, Res};

pub fn run(ctx: &Ctx, args: &[String]) -> Res {
    let (flags, after) = split_dashdash(args);
    let mut detach = false;
    let mut create: Option<String> = None;
    let mut positional: Vec<String> = after.to_vec();
    let mut it = flags.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--detach" | "-d" => detach = true,
            "-q" | "--quiet" | "--no-guess" | "--guess" => {}
            "-c" | "--create" => match it.next() {
                Some(n) => create = Some(n.clone()),
                None => return Ok(fail(129, "error: switch `c' requires a value")),
            },
            s if s.starts_with('-') && s.len() > 1 => {
                let mut full = vec!["switch".to_string()];
                full.extend(args.iter().cloned());
                return Ok(unsupported(&full));
            }
            _ => positional.push(a.clone()),
        }
    }
    let repo = ctx.open()?;
    let target = if let Some(new) = &create {
        let start = positional.first().map_or("HEAD", String::as_str);
        let commit = match repo.revparse_single(start).and_then(|o| o.peel_to_commit()) {
            Ok(c) => c,
            Err(_) => return Ok(fail(128, &format!("fatal: invalid reference: {start}"))),
        };
        if repo.find_branch(new, BranchType::Local).is_ok() {
            return Ok(fail(
                128,
                &format!("fatal: a branch named '{new}' already exists"),
            ));
        }
        repo.branch(new, &commit, false)?;
        (format!("refs/heads/{new}"), commit, true)
    } else {
        let Some(name) = positional.first() else {
            return Ok(fail(128, "fatal: missing branch or commit argument"));
        };
        if detach {
            let commit = match repo.revparse_single(name).and_then(|o| o.peel_to_commit()) {
                Ok(c) => c,
                Err(_) => return Ok(fail(128, &format!("fatal: invalid reference: {name}"))),
            };
            (String::new(), commit, false)
        } else {
            let refname = format!("refs/heads/{name}");
            match repo.find_reference(&refname) {
                Ok(r) => (refname, r.peel_to_commit()?, false),
                Err(_) => match guess_remote(&repo, name) {
                    Some(remote_commit) => {
                        let (remote_branch, commit) = remote_commit;
                        let mut b = repo.branch(name, &commit, false)?;
                        b.set_upstream(Some(&remote_branch))?;
                        (refname, commit, true)
                    }
                    None => {
                        return Ok(fail(128, &format!("fatal: invalid reference: {name}")));
                    }
                },
            }
        }
    };
    let (refname, commit, created) = target;
    if !created && !refname.is_empty() {
        if let Ok(head) = repo.head() {
            if head.name().ok() == Some(refname.as_str()) {
                let short = refname.trim_start_matches("refs/heads/");
                return Ok(super::CliOutput {
                    stdout: Vec::new(),
                    stderr: format!("Already on '{short}'\n"),
                    code: 0,
                });
            }
        }
    }
    let tree = commit.tree()?;
    if let Err(files) = checkout_safe(&repo, tree.as_object())? {
        // A branch created for this call must not linger.
        if created {
            if let Some(short) = refname.strip_prefix("refs/heads/") {
                if let Ok(mut b) = repo.find_branch(short, BranchType::Local) {
                    let _ = b.delete();
                }
            }
        }
        return Ok(fail(
            1,
            &overwritten_message(&files, "checkout", "switch branches"),
        ));
    }
    let stderr = if refname.is_empty() {
        repo.set_head_detached(commit.id())?;
        format!("HEAD is now at {}\n", &commit.id().to_string()[..7])
    } else {
        repo.set_head(&refname)?;
        let short = refname.trim_start_matches("refs/heads/");
        if created {
            format!("Switched to a new branch '{short}'\n")
        } else {
            format!("Switched to branch '{short}'\n")
        }
    };
    Ok(super::CliOutput {
        stdout: Vec::new(),
        stderr,
        code: 0,
    })
}

/// `refs/remotes/<remote>/<name>` when exactly one remote has `name`.
fn guess_remote<'r>(repo: &'r git2::Repository, name: &str) -> Option<(String, git2::Commit<'r>)> {
    let mut found = Vec::new();
    for b in repo.branches(Some(BranchType::Remote)).ok()? {
        let (b, _) = b.ok()?;
        let full = b.name().ok()??.to_string();
        if full.split_once('/').map(|(_, n)| n) == Some(name) && !full.ends_with("/HEAD") {
            found.push((full, b.get().peel_to_commit().ok()?));
        }
    }
    if found.len() == 1 {
        found.pop()
    } else {
        None
    }
}
