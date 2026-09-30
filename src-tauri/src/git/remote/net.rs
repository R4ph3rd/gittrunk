//! Synchronous cores of the network operations (fetch, pull, push, clone,
//! remote branch delete). The async plumbing (op ids, events, credential
//! prompts) lives in `ops.rs`; these functions only need a `NetSession`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use git2::{BranchType, Repository};
use parking_lot::Mutex;

use super::creds::{CredentialBridge, CredentialResolver};
use super::native;
use super::progress::{parse_progress, Progress};
use super::validate;
use crate::git::cli::{CliOptions, CliOutput, GitCli, OpHandle};
use crate::git::libgit::repo::head_state;
use crate::git::oplog::Oplog;
use crate::git::preview::{self, PlannedUpdate};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

// --------------------------------------------------------------- session

/// Everything a network git call needs: the runner, cancellation, the
/// credential bridge and a progress sink.
pub struct NetSession {
    pub cli: GitCli,
    pub op: Option<Arc<OpHandle>>,
    pub bridge: Option<CredentialBridge>,
    /// Credential source for the libgit2 backend (embedded builds).
    pub resolver: Option<Arc<CredentialResolver>>,
    progress: Mutex<Box<dyn FnMut(Progress) + Send>>,
}

impl NetSession {
    /// No credential bridge, no cancellation, progress discarded.
    pub fn plain(cli: GitCli) -> Self {
        Self::new(cli, None, None, Box::new(|_| {}))
    }

    pub fn new(
        cli: GitCli,
        op: Option<Arc<OpHandle>>,
        bridge: Option<CredentialBridge>,
        progress: Box<dyn FnMut(Progress) + Send>,
    ) -> Self {
        Self {
            cli,
            op,
            bridge,
            resolver: None,
            progress: Mutex::new(progress),
        }
    }

    pub fn with_resolver(mut self, resolver: Arc<CredentialResolver>) -> Self {
        self.resolver = Some(resolver);
        self
    }

    /// Forwards a progress update to the sink (used by the native backend).
    pub fn report(&self, p: Progress) {
        (self.progress.lock())(p);
    }

    /// Runs git with the credential environment, parsing progress lines.
    /// Returns the output whatever the exit code was.
    pub fn run(&self, dir: &Path, args: &[String]) -> AppResult<CliOutput> {
        let mut opts = CliOptions::default();
        if let Some(bridge) = &self.bridge {
            opts.env = bridge.env();
        }
        opts.env.push(("GIT_EDITOR".into(), "true".into()));
        opts.env.push(("GIT_MERGE_AUTOEDIT".into(), "no".into()));
        let mut progress = self.progress.lock();
        self.cli
            .run_streaming(dir, args, &opts, self.op.as_deref(), &mut |line| {
                if let Some(p) = parse_progress(line) {
                    (progress)(p);
                }
            })
    }

    /// Like `run`, but a non-zero exit is an error.
    pub fn run_ok(&self, dir: &Path, args: &[String]) -> AppResult<CliOutput> {
        let out = self.run(dir, args)?;
        if out.success() {
            Ok(out)
        } else {
            Err(failure_error(&out))
        }
    }
}

// --------------------------------------------------------------- errors

/// Error kind for a failed network git call, from its stderr.
pub fn classify_failure(stderr: &str) -> ErrorKind {
    let s = stderr.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| s.contains(n));
    if has(&["could not read username", "could not read password"]) {
        ErrorKind::AuthRequired
    } else if has(&[
        "authentication failed",
        "permission denied (publickey",
        "permission denied (password",
        "invalid username or password",
        "http basic: access denied",
    ]) {
        ErrorKind::AuthFailed
    } else if has(&[
        "could not resolve host",
        "connection timed out",
        "connection refused",
        "network is unreachable",
        "failed to connect to",
        "connection reset",
    ]) {
        ErrorKind::Network
    } else if has(&[
        "would be overwritten",
        "please commit your changes or stash",
        "you have unstaged changes",
        "your local changes",
    ]) {
        ErrorKind::DirtyWorktree
    } else {
        ErrorKind::GitCli
    }
}

/// `AppError` for a failed git call: classified kind, the most telling line
/// as message, the whole stderr as detail.
pub fn failure_error(out: &CliOutput) -> AppError {
    let lines = || out.stderr.lines().map(str::trim).filter(|l| !l.is_empty());
    let message = lines()
        .rfind(|l| l.starts_with("fatal:") || l.starts_with("error:"))
        .or_else(|| lines().next())
        .map(|l| {
            l.trim_start_matches("fatal:")
                .trim_start_matches("error:")
                .trim()
                .to_string()
        })
        .unwrap_or_else(|| format!("git exited with status {}", out.code));
    AppError::new(classify_failure(&out.stderr), message).with_detail(out.stderr.clone())
}

// --------------------------------------------------------------- helpers

/// Working directory for CLI calls (the worktree, or the git dir when bare).
pub fn run_dir(repo: &Repository) -> PathBuf {
    repo.workdir().unwrap_or_else(|| repo.path()).to_path_buf()
}

fn short(oid: git2::Oid) -> String {
    oid.to_string()[..7].to_string()
}

/// Paths with unresolved conflicts in the index.
pub fn conflicted_files(repo: &Repository) -> AppResult<Vec<String>> {
    let mut index = repo.index()?;
    index.read(true)?;
    if !index.has_conflicts() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for c in index.conflicts()? {
        let c = c?;
        let entry = c.our.or(c.their).or(c.ancestor);
        if let Some(e) = entry {
            files.push(String::from_utf8_lossy(&e.path).into_owned());
        }
    }
    files.sort();
    files.dedup();
    Ok(files)
}

// --------------------------------------------------------------- fetch

pub fn fetch_args(request: &FetchRequest) -> AppResult<Vec<String>> {
    let mut args = vec!["fetch".to_string(), "--progress".to_string()];
    if request.prune {
        args.push("--prune".into());
    }
    if request.tags {
        args.push("--tags".into());
    }
    match &request.remote {
        Some(remote) => {
            validate::remote_name(remote)?;
            args.push("--".into());
            args.push(remote.clone());
        }
        None => args.push("--all".into()),
    }
    Ok(args)
}

pub fn fetch(sess: &NetSession, dir: &Path, request: &FetchRequest) -> AppResult<()> {
    if native::enabled() {
        return native::fetch(sess, dir, request);
    }
    let args = fetch_args(request)?;
    sess.run_ok(dir, &args).map(|_| ())
}

// --------------------------------------------------------------- pull

pub fn pull_args(request: &PullRequest) -> AppResult<Vec<String>> {
    let mut args = vec!["pull".to_string(), "--progress".to_string()];
    match request.strategy {
        PullStrategy::Merge => {
            args.push("--no-rebase".into());
            args.push("--no-edit".into());
        }
        PullStrategy::Rebase => args.push("--rebase".into()),
        PullStrategy::FfOnly => args.push("--ff-only".into()),
    }
    if let Some(branch) = &request.branch {
        validate::branch(branch)?;
    }
    match (&request.remote, &request.branch) {
        (Some(remote), branch) => {
            validate::remote_name(remote)?;
            args.push("--".into());
            args.push(remote.clone());
            args.extend(branch.iter().cloned());
        }
        (None, Some(branch)) => {
            args.push("--".into());
            args.push("origin".into());
            args.push(branch.clone());
        }
        (None, None) => {}
    }
    Ok(args)
}

/// Pulls and records the operation in the oplog. Stops on conflicts with
/// `OpOutcome::Conflicted` (the merge or rebase stays in progress).
pub fn pull(sess: &NetSession, repo: &Repository, request: &PullRequest) -> AppResult<OpOutcome> {
    let args = pull_args(request)?;
    if repo.is_bare() {
        return Err(invalid("cannot pull in a bare repository"));
    }
    let dir = run_dir(repo);
    let summary = match request.strategy {
        PullStrategy::Merge => "Pull (merge)",
        PullStrategy::Rebase => "Pull (rebase)",
        PullStrategy::FfOnly => "Pull (fast-forward only)",
    }
    .to_string();
    let (conflicts, entry) = Oplog::record(repo, "pull", summary.clone(), false, |repo| {
        let out = if native::enabled() {
            // Native fetch first; only the merge/rebase step goes through git.
            match native::pull_prepare(sess, repo, request)? {
                None => return Ok(None),
                Some(merge_args) => sess.run(&dir, &merge_args)?,
            }
        } else {
            sess.run(&dir, &args)?
        };
        if out.success() {
            return Ok(None);
        }
        let files = conflicted_files(repo)?;
        if files.is_empty() {
            Err(failure_error(&out))
        } else {
            Ok(Some(files))
        }
    })?;
    Ok(match conflicts {
        Some(files) => OpOutcome::Conflicted {
            oplog_id: entry.id,
            files,
        },
        None => OpOutcome::Applied {
            oplog_id: entry.id,
            head: head_state(repo)?,
            message: summary,
        },
    })
}

// --------------------------------------------------------------- push

pub fn push_args(request: &PushRequest) -> AppResult<Vec<String>> {
    validate::remote_name(&request.remote)?;
    for spec in &request.refspecs {
        validate::refspec(spec)?;
    }
    let mut args = vec!["push".to_string(), "--progress".to_string()];
    if request.force_with_lease {
        args.push("--force-with-lease".into());
    }
    if request.set_upstream {
        args.push("-u".into());
    }
    if request.tags {
        args.push("--tags".into());
    }
    args.push("--".into());
    args.push(request.remote.clone());
    args.extend(request.refspecs.iter().cloned());
    Ok(args)
}

pub fn push(sess: &NetSession, dir: &Path, request: &PushRequest) -> AppResult<()> {
    if native::enabled() {
        return native::push(sess, dir, request);
    }
    let args = push_args(request)?;
    sess.run_ok(dir, &args).map(|_| ())
}

// --------------------------------------------------------------- clone

/// Validates the clone request; returns the absolute destination.
pub fn clone_target(request: &CloneRequest) -> AppResult<PathBuf> {
    validate::url(&request.url)?;
    if request.dest.trim().is_empty() || request.dest.starts_with('-') {
        return Err(invalid("destination is not a valid path"));
    }
    let dest = std::path::absolute(&request.dest)
        .map_err(|e| invalid(format!("invalid destination: {e}")))?;
    if dest.exists() {
        let empty_dir = dest.is_dir()
            && std::fs::read_dir(&dest)
                .map(|mut d| d.next().is_none())
                .unwrap_or(false);
        if !empty_dir {
            return Err(invalid(format!(
                "destination `{}` already exists and is not an empty directory",
                dest.display()
            )));
        }
    }
    Ok(dest)
}

pub fn clone_args(request: &CloneRequest, dest: &Path) -> Vec<String> {
    let mut args = vec!["clone".to_string(), "--progress".to_string()];
    if request.bare {
        args.push("--bare".into());
    }
    if request.recurse_submodules {
        args.push("--recurse-submodules".into());
    }
    args.push("--".into());
    args.push(request.url.clone());
    args.push(dest.to_string_lossy().into_owned());
    args
}

/// Clones into `request.dest`; a destination created by this call is removed
/// again when the clone fails or is cancelled.
pub fn clone(sess: &NetSession, request: &CloneRequest) -> AppResult<PathBuf> {
    let dest = clone_target(request)?;
    let existed = dest.exists();
    let parent = dest
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| invalid("destination has no parent directory"))?;
    std::fs::create_dir_all(&parent)?;
    let result = if native::enabled() {
        native::clone_into(sess, request, &dest)
    } else {
        let args = clone_args(request, &dest);
        sess.run_ok(&parent, &args).map(|_| ())
    };
    if result.is_err() {
        if existed {
            // Empty directory the user provided: leave it, but empty.
            if let Ok(rd) = std::fs::read_dir(&dest) {
                for e in rd.flatten() {
                    let p = e.path();
                    let _ = if p.is_dir() {
                        std::fs::remove_dir_all(p)
                    } else {
                        std::fs::remove_file(p)
                    };
                }
            }
        } else {
            let _ = std::fs::remove_dir_all(&dest);
        }
    }
    result.map(|()| dest)
}

// --------------------------------------------------------------- remote branch delete

/// Splits `origin/feature/x` (or `refs/remotes/origin/feature/x`) into
/// `(origin, feature/x)` using the repository's remote names; a bare
/// `feature` belongs to `origin`.
pub fn split_remote_branch(repo: &Repository, name: &str) -> AppResult<(String, String)> {
    let name = name.strip_prefix("refs/remotes/").unwrap_or(name);
    let remotes = repo.remotes()?;
    let mut names: Vec<&str> = remotes.iter().flatten().flatten().collect();
    names.sort_by_key(|n| std::cmp::Reverse(n.len()));
    for remote in names {
        if let Some(branch) = name
            .strip_prefix(remote)
            .and_then(|rest| rest.strip_prefix('/'))
        {
            return Ok((remote.to_string(), branch.to_string()));
        }
    }
    if !name.contains('/') && repo.find_remote("origin").is_ok() {
        return Ok(("origin".to_string(), name.to_string()));
    }
    Err(invalid(format!(
        "cannot tell which remote `{name}` belongs to"
    )))
}

/// Deletes a branch on its remote (`git push --delete`), synchronously.
pub fn delete_remote_branch(
    sess: &NetSession,
    repo: &Repository,
    request: &BranchDeleteRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    let (remote, branch) = split_remote_branch(repo, &request.name)?;
    validate::remote_name(&remote)?;
    validate::branch(&branch)?;
    let tracking = format!("refs/remotes/{remote}/{branch}");
    let tip = repo
        .find_branch(&format!("{remote}/{branch}"), BranchType::Remote)
        .map_err(|_| {
            AppError::new(
                ErrorKind::RefNotFound,
                format!("no remote-tracking branch `{remote}/{branch}`"),
            )
        })?
        .get()
        .peel_to_commit()?
        .id();
    let summary = format!(
        "Delete remote branch {remote}/{branch} (was {})",
        short(tip)
    );
    if dry_run {
        let planned = [PlannedUpdate::new(tracking, Some(tip), None)];
        let warnings = vec![format!("Deletes `{branch}` on the remote `{remote}`")];
        return Ok(OpOutcome::Preview {
            preview: preview::build(repo, summary, &planned, 0, warnings, Vec::new())?,
        });
    }
    let dir = run_dir(repo);
    let args: Vec<String> = ["push", "--progress", "--delete", "--"]
        .iter()
        .map(|s| s.to_string())
        .chain([remote.clone(), branch.clone()])
        .collect();
    let ((), entry) = Oplog::record(repo, "branch_delete_remote", summary.clone(), false, |_| {
        if native::enabled() {
            native::delete_remote_branch(sess, repo, &remote, &branch)
        } else {
            sess.run_ok(&dir, &args).map(|_| ())
        }
    })?;
    Ok(OpOutcome::Applied {
        oplog_id: entry.id,
        head: head_state(repo)?,
        message: summary,
    })
}
