//! `git worktree list --porcelain`, `git worktree add [-b|-B <branch>]
//! [--] <path> [<commit-ish>]` and `git worktree remove [-f] [--] <path>`,
//! on libgit2's worktree API.
//!
//! Known divergences from git: `add` accepts only a local branch (or none)
//! as commit-ish, so detached worktrees (`--detach`, tags, commit ids) are
//! unsupported; `remove` needs a single `--force` for locked worktrees;
//! `prunable` is reported when the worktree directory is missing.

use std::fs;
use std::path::{Path, PathBuf};

use git2::{
    BranchType, Repository, StatusOptions, Worktree, WorktreeAddOptions, WorktreeLockStatus,
    WorktreePruneOptions,
};

use super::{fail, ok, split_dashdash, unsupported, AppResult, CliOutput, Ctx, Res};

pub fn run(ctx: &Ctx, args: &[String]) -> Res {
    match args.first().map(String::as_str) {
        Some("list") => list(ctx, &args[1..]),
        Some("add") => add(ctx, &args[1..]),
        Some("remove") | Some("rm") => remove(ctx, &args[1..]),
        _ => {
            let mut full = vec!["worktree".to_string()];
            full.extend(args.iter().cloned());
            Ok(unsupported(&full))
        }
    }
}

// ------------------------------------------------------------------- model

/// One worktree as `git worktree list` sees it.
struct Entry {
    /// Forward-slash path without trailing slash.
    path: String,
    /// Object id of HEAD (zeros when unborn).
    head: String,
    /// `refs/heads/...` when HEAD is a branch.
    branch: Option<String>,
    bare: bool,
    locked: Option<Option<String>>,
    prunable: bool,
    /// Name of the admin directory (`None` for the main worktree).
    name: Option<String>,
}

const ZERO: &str = "0000000000000000000000000000000000000000";

fn norm(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    if s.len() > 1 {
        s.trim_end_matches('/').to_string()
    } else {
        s
    }
}

/// `(head oid, branch ref)` from a `HEAD` file.
fn read_head(main: &Repository, head_file: &Path) -> (String, Option<String>) {
    let text = fs::read_to_string(head_file).unwrap_or_default();
    let text = text.trim();
    if let Some(target) = text.strip_prefix("ref:") {
        let target = target.trim().to_string();
        let oid = main
            .find_reference(&target)
            .ok()
            .and_then(|r| r.peel_to_commit().ok())
            .map(|c| c.id().to_string())
            .unwrap_or_else(|| ZERO.to_string());
        (oid, Some(target))
    } else if text.len() >= 40 {
        (text[..40].to_string(), None)
    } else {
        (ZERO.to_string(), None)
    }
}

fn worktree_names(repo: &Repository) -> Vec<String> {
    repo.worktrees()
        .map(|w| w.iter().flatten().flatten().map(str::to_string).collect())
        .unwrap_or_default()
}

fn entries(repo: &Repository) -> AppResult<Vec<Entry>> {
    let common = repo.commondir().to_path_buf();
    let main = Repository::open(&common)?;
    let bare = main.is_bare();
    let main_path = if bare {
        norm(&common)
    } else {
        norm(main.workdir().unwrap_or(&common))
    };
    let (head, branch) = read_head(&main, &common.join("HEAD"));
    let mut out = vec![Entry {
        path: main_path,
        head,
        branch,
        bare,
        locked: None,
        prunable: false,
        name: None,
    }];
    let mut names = worktree_names(repo);
    names.sort();
    for name in names {
        let Ok(wt) = repo.find_worktree(&name) else {
            continue;
        };
        let (head, branch) = read_head(&main, &common.join("worktrees").join(&name).join("HEAD"));
        let locked = match wt.is_locked() {
            Ok(WorktreeLockStatus::Locked(reason)) => Some(reason.filter(|r| !r.is_empty())),
            _ => None,
        };
        let prunable = locked.is_none() && !wt.path().exists();
        out.push(Entry {
            path: norm(wt.path()),
            head,
            branch,
            bare: false,
            locked,
            prunable,
            name: Some(name),
        });
    }
    Ok(out)
}

fn porcelain(entries: &[Entry]) -> String {
    let mut s = String::new();
    for e in entries {
        s.push_str(&format!("worktree {}\n", e.path));
        if e.bare {
            s.push_str("bare\n\n");
            continue;
        }
        s.push_str(&format!("HEAD {}\n", e.head));
        match &e.branch {
            Some(b) => s.push_str(&format!("branch {b}\n")),
            None => s.push_str("detached\n"),
        }
        match &e.locked {
            Some(Some(reason)) => s.push_str(&format!("locked {reason}\n")),
            Some(None) => s.push_str("locked\n"),
            None => {}
        }
        if e.prunable {
            s.push_str("prunable gitdir file points to non-existent location\n");
        }
        s.push('\n');
    }
    s
}

/// Human format of `git worktree list` (no `--porcelain`).
fn plain(entries: &[Entry]) -> String {
    let width = entries.iter().map(|e| e.path.len()).max().unwrap_or(0);
    let mut s = String::new();
    for e in entries {
        let label = if e.bare {
            "(bare)".to_string()
        } else {
            let short = &e.head[..7.min(e.head.len())];
            match &e.branch {
                Some(b) => format!("{short} [{}]", b.strip_prefix("refs/heads/").unwrap_or(b)),
                None => format!("{short} (detached HEAD)"),
            }
        };
        s.push_str(&format!("{:<width$}  {label}\n", e.path));
    }
    s
}

fn abs(ctx: &Ctx, raw: &str) -> PathBuf {
    let p = PathBuf::from(raw);
    if p.is_absolute() {
        p
    } else {
        ctx.dir.join(p)
    }
}

fn same_path(a: &str, b: &Path) -> bool {
    let a = Path::new(a);
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => norm(a) == norm(b),
    }
}

// -------------------------------------------------------------------- list

fn list(ctx: &Ctx, args: &[String]) -> Res {
    let mut porc = false;
    for a in args {
        match a.as_str() {
            "--porcelain" => porc = true,
            "-v" | "--verbose" => {}
            _ => return Ok(unsupported(&full("list", args))),
        }
    }
    let repo = ctx.open()?;
    let all = entries(&repo)?;
    Ok(ok(if porc { porcelain(&all) } else { plain(&all) }))
}

fn full(sub: &str, args: &[String]) -> Vec<String> {
    let mut v = vec!["worktree".to_string(), sub.to_string()];
    v.extend(args.iter().cloned());
    v
}

// --------------------------------------------------------------------- add

fn unique_name(repo: &Repository, base: &str) -> String {
    let taken = worktree_names(repo);
    if !taken.iter().any(|n| n == base) {
        return base.to_string();
    }
    (1..)
        .map(|i| format!("{base}{i}"))
        .find(|n| !taken.contains(n))
        .unwrap_or_else(|| base.to_string())
}

fn add(ctx: &Ctx, args: &[String]) -> Res {
    let (flags, after) = split_dashdash(args);
    let mut new_branch: Option<(&String, bool)> = None;
    let mut pos: Vec<&String> = Vec::new();
    let mut it = flags.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-q" | "--quiet" | "-f" | "--force" | "--checkout" => {}
            "-b" | "-B" => match it.next() {
                Some(v) => new_branch = Some((v, a == "-B")),
                None => return Ok(fail(129, "error: switch `b' requires a value")),
            },
            s if s.starts_with('-') && s.len() > 1 => return Ok(unsupported(&full("add", args))),
            _ => pos.push(a),
        }
    }
    pos.extend(after.iter());
    let (path_arg, commitish) = match pos.as_slice() {
        [p] => (*p, None),
        [p, c] => (*p, Some(*c)),
        _ => {
            return Ok(fail(
                129,
                "usage: git worktree add [-b <branch>] <path> [<commit-ish>]",
            ))
        }
    };
    let repo = ctx.open()?;
    let path = abs(ctx, path_arg);
    if path.exists() {
        let empty = path.is_dir()
            && fs::read_dir(&path)
                .map(|mut d| d.next().is_none())
                .unwrap_or(false);
        if !empty {
            return Ok(fail(
                128,
                &format!("fatal: '{}' already exists", norm(&path)),
            ));
        }
    }

    // What to check out.
    let mut created: Option<String> = None;
    let branch_name: String;
    match new_branch {
        Some((name, force)) => {
            if !git2::Reference::is_valid_name(&format!("refs/heads/{name}")) {
                return Ok(fail(
                    128,
                    &format!("fatal: '{name}' is not a valid branch name"),
                ));
            }
            if !force && repo.find_branch(name, BranchType::Local).is_ok() {
                return Ok(fail(
                    128,
                    &format!("fatal: a branch named '{name}' already exists"),
                ));
            }
            let spec = commitish.map(String::as_str).unwrap_or("HEAD");
            let Ok(commit) = repo.revparse_single(spec).and_then(|o| o.peel_to_commit()) else {
                return Ok(fail(128, &format!("fatal: invalid reference: {spec}")));
            };
            repo.branch(name, &commit, force)?;
            created = Some(name.clone());
            branch_name = name.clone();
        }
        None => match commitish {
            Some(c) => {
                if repo.find_branch(c, BranchType::Local).is_err() {
                    return Ok(unsupported(&full("add", args)));
                }
                branch_name = c.clone();
            }
            None => {
                let base = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if base.is_empty() || !git2::Reference::is_valid_name(&format!("refs/heads/{base}"))
                {
                    return Ok(fail(128, "fatal: invalid worktree path"));
                }
                if repo.find_branch(&base, BranchType::Local).is_err() {
                    let Ok(head) = repo.head().and_then(|h| h.peel_to_commit()) else {
                        return Ok(fail(128, "fatal: invalid reference: HEAD"));
                    };
                    repo.branch(&base, &head, false)?;
                    created = Some(base.clone());
                }
                branch_name = base;
            }
        },
    }
    let cleanup = |repo: &Repository| {
        if let Some(b) = &created {
            if let Ok(mut br) = repo.find_branch(b, BranchType::Local) {
                let _ = br.delete();
            }
        }
    };

    let full_ref = format!("refs/heads/{branch_name}");
    if let Some(other) = entries(&repo)?
        .iter()
        .find(|e| e.branch.as_deref() == Some(full_ref.as_str()))
    {
        let msg = format!(
            "fatal: '{branch_name}' is already checked out at '{}'",
            other.path
        );
        cleanup(&repo);
        return Ok(fail(128, &msg));
    }

    let reference = repo.find_reference(&full_ref)?;
    let base = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| branch_name.replace('/', "-"));
    let name = unique_name(&repo, &base);
    // libgit2 creates the directory itself and refuses an existing one.
    if path.is_dir() {
        let _ = fs::remove_dir(&path);
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut opts = WorktreeAddOptions::new();
    opts.reference(Some(&reference));
    if let Err(e) = repo.worktree(&name, &path, Some(&opts)) {
        cleanup(&repo);
        return Ok(fail(128, &format!("fatal: {}", e.message())));
    }
    Ok(CliOutput {
        stdout: Vec::new(),
        stderr: format!("Preparing worktree (checking out '{branch_name}')\n"),
        code: 0,
    })
}

// ------------------------------------------------------------------ remove

fn dirty(wt: &Worktree) -> bool {
    let Ok(repo) = Repository::open_from_worktree(wt) else {
        return false;
    };
    let mut o = StatusOptions::new();
    o.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    repo.statuses(Some(&mut o))
        .map(|s| s.iter().any(|e| !e.status().is_empty()))
        .unwrap_or(false)
}

fn remove(ctx: &Ctx, args: &[String]) -> Res {
    let (flags, after) = split_dashdash(args);
    let mut force = false;
    let mut pos: Vec<&String> = Vec::new();
    for a in flags {
        match a.as_str() {
            "-f" | "--force" => force = true,
            s if s.starts_with('-') && s.len() > 1 => {
                return Ok(unsupported(&full("remove", args)))
            }
            _ => pos.push(a),
        }
    }
    pos.extend(after.iter());
    let [path_arg] = pos.as_slice() else {
        return Ok(fail(129, "usage: git worktree remove [-f] <worktree>"));
    };
    let repo = ctx.open()?;
    let target = abs(ctx, path_arg);
    let all = entries(&repo)?;
    let Some(entry) = all.iter().find(|e| same_path(&e.path, &target)) else {
        return Ok(fail(
            128,
            &format!("fatal: '{path_arg}' is not a working tree"),
        ));
    };
    let Some(name) = &entry.name else {
        return Ok(fail(
            128,
            &format!("fatal: '{path_arg}' is a main working tree"),
        ));
    };
    if entry.locked.is_some() && !force {
        return Ok(fail(
            128,
            "fatal: cannot remove a locked working tree, lock reason: use --force to delete it",
        ));
    }
    let wt = repo.find_worktree(name)?;
    if !force && wt.path().exists() && dirty(&wt) {
        return Ok(fail(
            128,
            &format!(
                "fatal: '{path_arg}' contains modified or untracked files, use --force to delete it"
            ),
        ));
    }
    let mut opts = WorktreePruneOptions::new();
    opts.valid(true).working_tree(true).locked(force);
    wt.prune(Some(&mut opts))?;
    Ok(ok(""))
}
