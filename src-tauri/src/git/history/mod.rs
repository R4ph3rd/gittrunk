//! History-rewriting and history-joining operations: merge, rebase (plain and
//! interactive), cherry-pick, revert and the sequencer controls. Kept in its
//! own trait so it does not touch `GitService`.
//!
//! The work itself runs through the git CLI so hooks, rerere and config behave
//! like git; libgit2 is used for validation and for the in-memory dry-run
//! simulation (`sim.rs`). Every applied operation is bracketed by an oplog
//! entry, including the ones that stop on conflicts.

mod merge;
mod pick;
mod rebase;
mod sequencer;
mod sim;

use std::path::Path;

use git2::{Oid, Repository, RepositoryState, Sort, StatusOptions};

use crate::git::cli::{CliOptions, CliOutput, GitCli};
use crate::git::conflicts::conflicted_paths;
use crate::git::libgit::repo::head_state;
use crate::git::libgit::LibGit;
use crate::git::oplog::Oplog;
use crate::git::preview::{self, PlannedUpdate};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub trait HistoryService: Send + Sync {
    fn merge(
        &self,
        repo: &Repository,
        request: &MergeRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    fn rebase(
        &self,
        repo: &Repository,
        request: &RebaseRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    /// Commits in `base..HEAD`, oldest first, as an all-`pick` todo.
    fn rebase_todo_load(&self, repo: &Repository, base: &str) -> AppResult<Vec<RebaseTodoItem>>;
    fn rebase_interactive(
        &self,
        repo: &Repository,
        request: &InteractiveRebaseRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    fn cherry_pick(
        &self,
        repo: &Repository,
        request: &CherryPickRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    fn revert(
        &self,
        repo: &Repository,
        request: &RevertRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    /// Continues, skips or aborts the operation that is in progress.
    fn sequencer_control(&self, repo: &Repository, action: SequencerAction)
        -> AppResult<OpOutcome>;
}

impl HistoryService for LibGit {
    fn merge(
        &self,
        repo: &Repository,
        request: &MergeRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        merge::merge(repo, request, dry_run)
    }

    fn rebase(
        &self,
        repo: &Repository,
        request: &RebaseRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        rebase::rebase(repo, request, dry_run)
    }

    fn rebase_todo_load(&self, repo: &Repository, base: &str) -> AppResult<Vec<RebaseTodoItem>> {
        rebase::todo_load(repo, base)
    }

    fn rebase_interactive(
        &self,
        repo: &Repository,
        request: &InteractiveRebaseRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        rebase::interactive(repo, request, dry_run)
    }

    fn cherry_pick(
        &self,
        repo: &Repository,
        request: &CherryPickRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        pick::pick(
            repo,
            &request.commits,
            request.target_branch.as_deref(),
            request.no_commit,
            false,
            dry_run,
        )
    }

    fn revert(
        &self,
        repo: &Repository,
        request: &RevertRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        pick::pick(
            repo,
            &request.commits,
            None,
            request.no_commit,
            true,
            dry_run,
        )
    }

    fn sequencer_control(
        &self,
        repo: &Repository,
        action: SequencerAction,
    ) -> AppResult<OpOutcome> {
        sequencer::control(repo, action)
    }
}

// ------------------------------------------------------------------ helpers

/// git never waits for an editor. `true` is a no-op command on Unix; `:` is
/// git's documented "no editor" value and does not depend on a `true`
/// executable being on PATH (Windows).
const NO_EDITOR: &str = if cfg!(windows) { ":" } else { "true" };

pub(super) fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

pub(super) fn workdir(repo: &Repository) -> AppResult<&Path> {
    repo.workdir()
        .ok_or_else(|| invalid("repository has no working tree"))
}

pub(super) fn short(oid: Oid) -> String {
    oid.to_string()[..7].to_string()
}

/// Runs git in the working tree without ever opening an editor. `env`
/// entries override the defaults.
pub(super) fn run_git(
    repo: &Repository,
    args: &[String],
    env: &[(&str, String)],
) -> AppResult<CliOutput> {
    let mut opts = CliOptions {
        env: vec![
            ("GIT_EDITOR".into(), NO_EDITOR.into()),
            ("GIT_SEQUENCE_EDITOR".into(), NO_EDITOR.into()),
            ("GIT_MERGE_AUTOEDIT".into(), "no".into()),
        ],
        ..CliOptions::default()
    };
    opts.env
        .extend(env.iter().map(|(k, v)| ((*k).to_string(), v.clone())));
    GitCli::new().run_raw(workdir(repo)?, args, &opts)
}

pub(super) fn args(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| (*s).to_string()).collect()
}

/// How a git invocation ended.
#[derive(Debug)]
pub(super) enum Stop {
    Done,
    /// Stopped on conflicts (possibly none listed: e.g. an emptied commit).
    Conflicts(Vec<String>),
    /// A rebase paused for `edit`; carries the short id of HEAD.
    Edit(String),
}

fn maps_to_dirty(stderr: &str) -> bool {
    let s = stderr.to_ascii_lowercase();
    [
        "would be overwritten",
        "unstaged changes",
        "uncommitted changes",
        "local changes",
    ]
    .iter()
    .any(|m| s.contains(m))
}

fn cli_error(out: CliOutput) -> AppError {
    let dirty = maps_to_dirty(&out.stderr);
    let err = out.into_result().expect_err("non-zero exit");
    if dirty {
        AppError {
            kind: ErrorKind::DirtyWorktree,
            ..err
        }
    } else {
        err
    }
}

pub(super) fn in_progress(repo: &Repository) -> bool {
    !matches!(repo.state(), RepositoryState::Clean)
}

pub(super) fn is_rebase_state(state: RepositoryState) -> bool {
    matches!(
        state,
        RepositoryState::Rebase
            | RepositoryState::RebaseInteractive
            | RepositoryState::RebaseMerge
            | RepositoryState::ApplyMailbox
            | RepositoryState::ApplyMailboxOrRebase
    )
}

/// Classifies a finished git process: done, stopped on conflicts (or another
/// pause of a sequencer operation), or a real error.
pub(super) fn interpret(repo: &Repository, out: CliOutput) -> AppResult<Stop> {
    if out.success() {
        if is_rebase_state(repo.state()) {
            let head = repo.head()?.peel_to_commit()?.id();
            return Ok(Stop::Edit(short(head)));
        }
        return Ok(Stop::Done);
    }
    let files = conflicted_paths(repo)?;
    if !files.is_empty() || in_progress(repo) {
        return Ok(Stop::Conflicts(files));
    }
    Err(cli_error(out))
}

pub(super) fn ensure_idle(repo: &Repository) -> AppResult<()> {
    if repo.is_bare() {
        return Err(invalid("repository has no working tree"));
    }
    if in_progress(repo) {
        return Err(invalid(format!(
            "another operation is in progress ({:?}); continue or abort it first",
            repo.state()
        )));
    }
    if repo.head().is_err() {
        return Err(invalid("HEAD has no commits yet"));
    }
    Ok(())
}

pub(super) fn head_commit(repo: &Repository) -> AppResult<git2::Commit<'_>> {
    Ok(repo.head()?.peel_to_commit()?)
}

/// Short name of the checked-out branch (`None` when HEAD is detached).
pub(super) fn current_branch(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if repo.head_detached().unwrap_or(false) {
        return None;
    }
    head.shorthand().ok().map(str::to_string)
}

/// Refuses when tracked files are modified or staged (untracked files are
/// fine: they do not block a checkout of another branch by themselves).
pub(super) fn ensure_clean_tracked(repo: &Repository) -> AppResult<()> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(false).include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts))?;
    let dirty: Vec<String> = statuses
        .iter()
        .filter(|e| !e.status().is_empty() && !e.status().is_ignored())
        .filter_map(|e| e.path().ok().map(str::to_string))
        .collect();
    if dirty.is_empty() {
        return Ok(());
    }
    Err(AppError::new(
        ErrorKind::DirtyWorktree,
        format!(
            "commit or stash your changes first: {}",
            dirty
                .iter()
                .take(5)
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join(", ")
        ),
    )
    .with_detail(dirty.join("\n")))
}

/// A revision the user named. A leading `-` is refused so it can never be
/// read as an option; the result is a commit that exists.
pub(super) fn resolve_commit<'r>(repo: &'r Repository, spec: &str) -> AppResult<git2::Commit<'r>> {
    let spec = spec.trim();
    if spec.is_empty() || spec.starts_with('-') || spec.contains('\0') {
        return Err(invalid(format!("`{spec}` is not a valid revision")));
    }
    let obj = repo.revparse_single(spec).map_err(|e| {
        if e.code() == git2::ErrorCode::Ambiguous {
            invalid(format!("`{spec}` is ambiguous"))
        } else {
            AppError::new(ErrorKind::RefNotFound, format!("cannot resolve `{spec}`"))
        }
    })?;
    obj.peel_to_commit().map_err(|_| {
        AppError::new(
            ErrorKind::RefNotFound,
            format!("`{spec}` does not point to a commit"),
        )
    })
}

/// A commit id given as hex (full or abbreviated) and nothing else.
pub(super) fn resolve_hex<'r>(repo: &'r Repository, oid: &str) -> AppResult<git2::Commit<'r>> {
    let oid = oid.trim();
    if oid.len() < 4 || oid.len() > 40 || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(invalid(format!("`{oid}` is not a valid object id")));
    }
    resolve_commit(repo, oid)
}

/// An existing local branch; the name is checked so it cannot look like an
/// option.
pub(super) fn local_branch(repo: &Repository, name: &str) -> AppResult<String> {
    if name.starts_with('-') || !git2::Branch::name_is_valid(name).unwrap_or(false) {
        return Err(invalid(format!("`{name}` is not a valid branch name")));
    }
    repo.find_branch(name, git2::BranchType::Local)
        .map_err(|_| AppError::new(ErrorKind::RefNotFound, format!("no local branch `{name}`")))?;
    Ok(name.to_string())
}

/// Commits in `base..tip`, oldest first.
pub(super) fn range_oldest_first(repo: &Repository, tip: Oid, base: Oid) -> AppResult<Vec<Oid>> {
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE)?;
    walk.push(tip)?;
    walk.hide(base)?;
    let mut out = Vec::new();
    for oid in walk {
        out.push(oid?);
    }
    Ok(out)
}

/// Full ref name to report in previews: the branch, or `HEAD` when detached.
pub(super) fn head_ref_name(repo: &Repository) -> String {
    match current_branch(repo) {
        Some(b) => format!("refs/heads/{b}"),
        None => "HEAD".to_string(),
    }
}

pub(super) fn record(
    repo: &Repository,
    operation: &str,
    description: String,
    f: impl FnOnce(&Repository) -> AppResult<Stop>,
) -> AppResult<(Stop, OplogEntry)> {
    Oplog::record(repo, operation, description, false, f)
}

/// `done` is the message of a completed operation.
pub(super) fn outcome(
    repo: &Repository,
    stop: Stop,
    entry: OplogEntry,
    done: String,
) -> AppResult<OpOutcome> {
    Ok(match stop {
        Stop::Done => OpOutcome::Applied {
            oplog_id: entry.id,
            head: head_state(repo)?,
            message: done,
        },
        Stop::Edit(short) => OpOutcome::Applied {
            oplog_id: entry.id,
            head: head_state(repo)?,
            message: format!("Stopped for edit at {short}"),
        },
        Stop::Conflicts(files) => OpOutcome::Conflicted {
            oplog_id: entry.id,
            files,
        },
    })
}

pub(super) fn preview_outcome(
    repo: &Repository,
    summary: String,
    planned: &[PlannedUpdate],
    created: u32,
    warnings: Vec<String>,
    conflicts: Vec<String>,
) -> AppResult<OpOutcome> {
    Ok(OpOutcome::Preview {
        preview: preview::build(repo, summary, planned, created, warnings, conflicts)?,
    })
}

/// Checks out `branch` through the CLI (used inside a recorded operation).
pub(super) fn switch_branch(repo: &Repository, branch: &str) -> AppResult<()> {
    let out = run_git(repo, &args(&["switch", branch]), &[])?;
    if out.success() {
        Ok(())
    } else {
        Err(cli_error(out))
    }
}

#[cfg(test)]
mod tests;
