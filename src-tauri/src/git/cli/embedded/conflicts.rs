//! `git add -- <path>...` and `git rm [--quiet] [-f] [--cached] -- <path>...`
//! (conflict resolution).

use std::path::Path;

use git2::IndexAddOption;

use super::{fail, ok, split_dashdash, unsupported, Ctx, Res};

pub fn run(ctx: &Ctx, cmd: &str, args: &[String]) -> Res {
    let (flags, after) = split_dashdash(args);
    let mut paths: Vec<String> = after.to_vec();
    let mut cached = false;
    for a in flags {
        match a.as_str() {
            "-f" | "--force" | "-q" | "--quiet" | "-v" | "--verbose" | "-A" | "--all" => {}
            "--cached" if cmd == "rm" => cached = true,
            "-r" if cmd == "rm" => {}
            s if s.starts_with('-') && s.len() > 1 => {
                let mut full = vec![cmd.to_string()];
                full.extend(args.iter().cloned());
                return Ok(unsupported(&full));
            }
            _ => paths.push(a.clone()),
        }
    }
    if paths.is_empty() {
        return Ok(if cmd == "add" {
            ok("Nothing specified, nothing added.\n")
        } else {
            fail(
                128,
                "fatal: No pathspec was given. Which files should I remove?",
            )
        });
    }
    let repo = ctx.open()?;
    let Some(workdir) = repo.workdir().map(Path::to_path_buf) else {
        return Ok(fail(
            128,
            "fatal: this operation must be run in a work tree",
        ));
    };
    let mut index = repo.index()?;
    for raw in &paths {
        let rel = raw.replace('\\', "/");
        let rel = rel.trim_start_matches("./");
        let full = workdir.join(rel);
        if cmd == "add" {
            if rel == "." || full.is_dir() {
                let spec = if rel == "." { "*" } else { rel };
                index.add_all([spec], IndexAddOption::DEFAULT, None)?;
            } else if full.symlink_metadata().is_ok() {
                index.add_path(Path::new(rel))?;
            } else {
                // Deleted in the working tree: stage the deletion (also
                // resolves a modify/delete conflict).
                let known = index.get_path(Path::new(rel), 0).is_some()
                    || (1..=3).any(|s| index.get_path(Path::new(rel), s).is_some());
                if !known {
                    return Ok(fail(
                        128,
                        &format!("fatal: pathspec '{raw}' did not match any files"),
                    ));
                }
                index.remove_path(Path::new(rel))?;
            }
        } else {
            let known = index.get_path(Path::new(rel), 0).is_some()
                || (1..=3).any(|s| index.get_path(Path::new(rel), s).is_some());
            if !known {
                return Ok(fail(
                    128,
                    &format!("fatal: pathspec '{raw}' did not match any files"),
                ));
            }
            index.remove_path(Path::new(rel))?;
            if !cached {
                match std::fs::remove_file(&full) {
                    Ok(()) => prune_empty_parents(&workdir, &full),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
            }
        }
    }
    index.write()?;
    Ok(ok(""))
}

/// Removes now-empty directories above `file`, stopping at `workdir`.
fn prune_empty_parents(workdir: &Path, file: &Path) {
    let mut dir = file.parent();
    while let Some(d) = dir {
        if d == workdir || !d.starts_with(workdir) || std::fs::remove_dir(d).is_err() {
            break;
        }
        dir = d.parent();
    }
}
