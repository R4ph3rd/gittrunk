//! Stash writes (save, apply, pop, drop) through the git CLI.
//!
//! Undo limitation: oplog snapshots cover branches, tags, HEAD, the index and
//! the working tree, not `refs/stash`. Undoing `stash_save` / `stash_apply`
//! therefore restores the working tree but leaves the stash stack as it is,
//! and undoing `stash_drop` does not bring the entry back. To keep dropped and
//! popped stashes recoverable, their commits are pinned under
//! `refs/gittrunk/stash/<oid>` and `restore_dropped` re-stores one.

use git2::{Oid, Repository, StatusOptions};

use crate::git::cli::{CliOptions, GitCli};
use crate::git::libgit::repo::head_state;
use crate::git::libgit::LibGit;
use crate::git::oplog::Oplog;
use crate::git::preview;
use crate::git::staging::commit::{check_identity, no_editor_env};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub trait StashWriteService: Send + Sync {
    fn stash_save(
        &self,
        repo: &Repository,
        cli: &GitCli,
        request: &StashSaveRequest,
    ) -> AppResult<OpOutcome>;
    fn stash_apply(
        &self,
        repo: &Repository,
        cli: &GitCli,
        index: u32,
        pop: bool,
    ) -> AppResult<OpOutcome>;
    fn stash_drop(
        &self,
        repo: &Repository,
        cli: &GitCli,
        index: u32,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
}

/// (oid, message) of every stash, newest first.
fn stash_entries(repo: &Repository) -> Vec<(Oid, String)> {
    match repo.reflog("refs/stash") {
        Ok(log) => log
            .iter()
            .map(|e| {
                (
                    e.id_new(),
                    e.message().ok().flatten().unwrap_or_default().to_string(),
                )
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn stash_at(repo: &Repository, index: u32) -> AppResult<(Oid, String)> {
    stash_entries(repo)
        .into_iter()
        .nth(index as usize)
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::RefNotFound,
                format!("there is no stash at index {index}"),
            )
        })
}

fn pin_name(oid: Oid) -> String {
    format!("refs/gittrunk/stash/{oid}")
}

fn pin(repo: &Repository, oid: Oid) -> AppResult<()> {
    repo.reference(&pin_name(oid), oid, true, "gittrunk: keep stash")?;
    Ok(())
}

fn unpin(repo: &Repository, oid: Oid) {
    if let Ok(mut r) = repo.find_reference(&pin_name(oid)) {
        let _ = r.delete();
    }
}

fn workdir(repo: &Repository) -> AppResult<&std::path::Path> {
    repo.workdir().ok_or_else(|| {
        AppError::new(
            ErrorKind::InvalidInput,
            "stash needs a working tree (bare repository)",
        )
    })
}

fn has_stashable_changes(repo: &Repository, include_untracked: bool) -> AppResult<bool> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(include_untracked)
        .recurse_untracked_dirs(include_untracked)
        .include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts))?;
    Ok(statuses
        .iter()
        .any(|s| !s.status().is_empty() && !s.status().contains(git2::Status::IGNORED)))
}

fn conflicted_paths(repo: &Repository) -> AppResult<Vec<String>> {
    let mut index = repo.index()?;
    index.read(true)?;
    if !index.has_conflicts() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    for c in index.conflicts()? {
        let c = c?;
        if let Some(e) = c.our.or(c.their).or(c.ancestor) {
            paths.push(String::from_utf8_lossy(&e.path).into_owned());
        }
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn cli_error(out: &crate::git::cli::CliOutput) -> AppError {
    let all = format!("{}\n{}", out.stderr, out.stdout_str());
    let first = all
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("git stash failed")
        .to_string();
    let kind = if all.contains("would be overwritten") {
        ErrorKind::DirtyWorktree
    } else {
        ErrorKind::GitCli
    };
    AppError::new(kind, first).with_detail(all)
}

/// Puts a dropped stash commit back on the stash stack.
pub fn restore_dropped(repo: &Repository, cli: &GitCli, oid: Oid) -> AppResult<()> {
    let commit = repo.find_commit(oid)?;
    let message = commit
        .summary()
        .ok()
        .flatten()
        .unwrap_or("restored stash")
        .to_string();
    let hex = oid.to_string();
    cli.run(
        workdir(repo)?,
        &["stash", "store", "-m", message.as_str(), hex.as_str()],
    )?;
    Ok(())
}

enum Applied {
    Done,
    Conflicts(Vec<String>),
}

impl StashWriteService for LibGit {
    fn stash_save(
        &self,
        repo: &Repository,
        cli: &GitCli,
        request: &StashSaveRequest,
    ) -> AppResult<OpOutcome> {
        let dir = workdir(repo)?;
        check_identity(&repo.config()?)?;
        if repo.head().is_err() {
            return Err(AppError::new(
                ErrorKind::InvalidInput,
                "cannot stash before the first commit",
            ));
        }
        if !has_stashable_changes(repo, request.include_untracked)? {
            return Err(AppError::new(
                ErrorKind::InvalidInput,
                "there are no local changes to stash",
            ));
        }
        let mut args: Vec<String> = vec!["stash".into(), "push".into()];
        if request.include_untracked {
            args.push("--include-untracked".into());
        }
        if request.keep_index {
            args.push("--keep-index".into());
        }
        let message = request
            .message
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty());
        if let Some(m) = message {
            args.push("-m".into());
            args.push(m.to_string());
        }
        let opts = CliOptions {
            stdin: None,
            read_only: false,
            env: no_editor_env(),
        };
        let summary = match message {
            Some(m) => format!("Stash changes: {m}"),
            None => "Stash changes".to_string(),
        };
        let ((), entry) = Oplog::record(repo, "stash_save", summary.clone(), true, |_| {
            let out = cli.run_raw(dir, &args, &opts)?;
            if out.success() {
                Ok(())
            } else {
                Err(cli_error(&out))
            }
        })?;
        Ok(OpOutcome::Applied {
            oplog_id: entry.id,
            head: head_state(repo)?,
            message: "Saved stash@{0}".into(),
        })
    }

    fn stash_apply(
        &self,
        repo: &Repository,
        cli: &GitCli,
        index: u32,
        pop: bool,
    ) -> AppResult<OpOutcome> {
        let dir = workdir(repo)?;
        let (oid, msg) = stash_at(repo, index)?;
        let verb = if pop { "pop" } else { "apply" };
        let name = format!("stash@{{{index}}}");
        let opts = CliOptions {
            stdin: None,
            read_only: false,
            env: no_editor_env(),
        };
        if pop {
            pin(repo, oid)?;
        }
        let summary = format!("{} {name}: {msg}", if pop { "Pop" } else { "Apply" });
        let recorded = Oplog::record(repo, "stash_apply", summary, true, |repo| {
            let out = cli.run_raw(dir, &["stash", verb, name.as_str()], &opts)?;
            if out.success() {
                return Ok(Applied::Done);
            }
            let conflicts = conflicted_paths(repo)?;
            if conflicts.is_empty() {
                Err(cli_error(&out))
            } else {
                Ok(Applied::Conflicts(conflicts))
            }
        });
        let (result, entry) = match recorded {
            Ok(v) => v,
            Err(e) => {
                if pop {
                    unpin(repo, oid);
                }
                return Err(e);
            }
        };
        match result {
            Applied::Done => Ok(OpOutcome::Applied {
                oplog_id: entry.id,
                head: head_state(repo)?,
                message: if pop {
                    format!("Popped {name}")
                } else {
                    format!("Applied {name}")
                },
            }),
            Applied::Conflicts(files) => {
                // git keeps the stash when a pop conflicts.
                if pop {
                    unpin(repo, oid);
                }
                Ok(OpOutcome::Conflicted {
                    oplog_id: entry.id,
                    files,
                })
            }
        }
    }

    fn stash_drop(
        &self,
        repo: &Repository,
        cli: &GitCli,
        index: u32,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        let dir = workdir(repo)?;
        let (oid, msg) = stash_at(repo, index)?;
        let name = format!("stash@{{{index}}}");
        let summary = format!("Drop {name}: {msg}");
        if dry_run {
            let planned = [preview::PlannedUpdate::new(name.clone(), Some(oid), None)];
            let warnings = vec![format!(
                "The stash commit {} is kept under refs/gittrunk/stash/ so it can be restored.",
                &oid.to_string()[..7]
            )];
            let preview = preview::build(repo, summary, &planned, 0, warnings, Vec::new())?;
            return Ok(OpOutcome::Preview { preview });
        }
        pin(repo, oid)?;
        let opts = CliOptions {
            stdin: None,
            read_only: false,
            env: no_editor_env(),
        };
        let recorded = Oplog::record(repo, "stash_drop", summary, false, |_| {
            let out = cli.run_raw(dir, &["stash", "drop", name.as_str()], &opts)?;
            if out.success() {
                Ok(())
            } else {
                Err(cli_error(&out))
            }
        });
        match recorded {
            Ok(((), entry)) => Ok(OpOutcome::Applied {
                oplog_id: entry.id,
                head: head_state(repo)?,
                message: format!("Dropped {name} ({})", &oid.to_string()[..7]),
            }),
            Err(e) => {
                unpin(repo, oid);
                Err(e)
            }
        }
    }
}

#[cfg(test)]
mod tests;
