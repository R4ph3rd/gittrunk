//! Linked worktrees through the git CLI.

use std::path::{Path, PathBuf};

use super::invalid;
use crate::git::cli::GitCli;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

/// Parses `git worktree list --porcelain` (blocks separated by blank lines;
/// the first block is the main worktree).
pub fn parse_porcelain(text: &str) -> Vec<WorktreeInfo> {
    let mut out: Vec<WorktreeInfo> = Vec::new();
    let mut cur: Option<WorktreeInfo> = None;
    let flush = |cur: &mut Option<WorktreeInfo>, out: &mut Vec<WorktreeInfo>| {
        if let Some(mut w) = cur.take() {
            w.is_main = out.is_empty();
            out.push(w);
        }
    };
    for line in text.lines() {
        if line.trim().is_empty() {
            flush(&mut cur, &mut out);
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            flush(&mut cur, &mut out);
            cur = Some(WorktreeInfo {
                path: path.to_string(),
                branch: None,
                head: None,
                is_main: false,
                locked: false,
                prunable: false,
            });
            continue;
        }
        let Some(w) = cur.as_mut() else { continue };
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key {
            "HEAD" => w.head = Some(value.to_string()).filter(|v| v.bytes().any(|b| b != b'0')),
            "branch" => {
                w.branch = Some(
                    value
                        .strip_prefix("refs/heads/")
                        .unwrap_or(value)
                        .to_string(),
                )
            }
            "locked" => w.locked = true,
            "prunable" => w.prunable = true,
            _ => {}
        }
    }
    flush(&mut cur, &mut out);
    out
}

pub fn list(cli: &GitCli, dir: &Path) -> AppResult<Vec<WorktreeInfo>> {
    let out = cli.run_read(dir, &["worktree", "list", "--porcelain"])?;
    Ok(parse_porcelain(&out.stdout_str()))
}

/// Absolute path that does not exist or is an empty directory.
pub fn validate_new_path(path: &str) -> AppResult<PathBuf> {
    if path.is_empty() || path.contains('\0') {
        return Err(invalid("worktree path is empty"));
    }
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(invalid("worktree path must be absolute"));
    }
    if p.exists() {
        let empty = p.is_dir()
            && std::fs::read_dir(&p)
                .map(|mut d| d.next().is_none())
                .unwrap_or(false);
        if !empty {
            return Err(invalid(format!(
                "`{path}` already exists and is not an empty directory"
            )));
        }
    }
    Ok(p)
}

/// A valid local branch name that cannot be read as an option.
pub fn validate_branch(branch: &str) -> AppResult<()> {
    if branch.is_empty()
        || branch.starts_with('-')
        || branch == "HEAD"
        || !git2::Reference::is_valid_name(&format!("refs/heads/{branch}"))
    {
        return Err(invalid(format!("`{branch}` is not a valid branch name")));
    }
    Ok(())
}

pub fn add_args(request: &WorktreeAddRequest) -> AppResult<Vec<String>> {
    validate_new_path(&request.path)?;
    validate_branch(&request.branch)?;
    let mut args: Vec<String> = vec!["worktree".into(), "add".into()];
    if request.create_branch {
        args.push("-b".into());
        args.push(request.branch.clone());
        args.push("--".into());
        args.push(request.path.clone());
    } else {
        args.push("--".into());
        args.push(request.path.clone());
        args.push(request.branch.clone());
    }
    Ok(args)
}

fn same(a: &str, b: &Path) -> bool {
    let a = Path::new(a);
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

pub fn add(cli: &GitCli, dir: &Path, request: &WorktreeAddRequest) -> AppResult<WorktreeInfo> {
    let args = add_args(request)?;
    cli.run(dir, &args)?;
    let target = PathBuf::from(&request.path);
    list(cli, dir)?
        .into_iter()
        .find(|w| same(&w.path, &target))
        .ok_or_else(|| {
            crate::ipc::error::AppError::new(
                crate::ipc::error::ErrorKind::Internal,
                "worktree was created but is not listed",
            )
        })
}

/// Removes a linked worktree. The path must be one `worktree list` reports
/// (which also rules out option-like values); the main worktree is refused.
pub fn remove(cli: &GitCli, dir: &Path, path: &str, force: bool) -> AppResult<()> {
    if path.is_empty() || path.contains('\0') {
        return Err(invalid("worktree path is empty"));
    }
    let target = PathBuf::from(path);
    let all = list(cli, dir)?;
    let found = all
        .iter()
        .find(|w| same(&w.path, &target))
        .ok_or_else(|| invalid(format!("`{path}` is not a worktree of this repository")))?;
    if found.is_main {
        return Err(invalid("the main worktree cannot be removed"));
    }
    let mut args: Vec<String> = vec!["worktree".into(), "remove".into()];
    if force {
        args.push("--force".into());
    }
    args.push("--".into());
    args.push(found.path.clone());
    cli.run(dir, &args)?;
    Ok(())
}
