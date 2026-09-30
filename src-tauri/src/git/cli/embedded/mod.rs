//! In-process stand-in for the git CLI, built on libgit2. Used when
//! `cfg(embedded_git)` is set (Android): the `GitCli` call sites keep building
//! plain `git` argument vectors and this module answers them with a
//! `CliOutput` shaped like git's (exit code, stdout, stderr).
//!
//! Exit codes mirror git: 0 success, 1 conflicts or a refused operation,
//! 128 fatal. Anything outside the supported dialect returns the
//! "unsupported on this platform" result, which `CliOutput::into_result`
//! maps to `ErrorKind::Unsupported`.

mod commit;
mod conflicts;
mod log;
mod merge;
mod pick;
mod rebase;
mod reset;
mod sequencer;
mod stash;
mod switch;
mod worktree;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use git2::{Repository, Signature, Time};

use super::{CliOptions, CliOutput, OpHandle};
use crate::ipc::error::{AppError, AppResult, ErrorKind};

/// Prefix of the stderr line of an unsupported invocation. `CliOutput`
/// recognises it to produce `ErrorKind::Unsupported`.
pub const UNSUPPORTED_PREFIX: &str = "error: unsupported on this platform:";

/// Result of a handler.
pub type Res = AppResult<CliOutput>;

/// What a handler knows about the invocation.
#[derive(Debug, Clone)]
pub struct Ctx {
    /// Working directory (`-C` applied).
    pub dir: PathBuf,
    /// Data of `CliOptions::stdin`.
    pub stdin: Option<Vec<u8>>,
    /// `-c key=value` overrides, in order.
    pub config: Vec<(String, String)>,
    /// `CliOptions::env`, in order (later entries win).
    pub env: Vec<(String, String)>,
}

impl Ctx {
    /// Opens the repository containing `dir`.
    pub fn open(&self) -> AppResult<Repository> {
        Repository::open(&self.dir)
            .or_else(|_| Repository::discover(&self.dir))
            .map_err(|_| {
                AppError::new(
                    ErrorKind::NotARepo,
                    "not a git repository (or any of the parent directories): .git",
                )
            })
    }

    /// `-c key=value` override, else the repository configuration.
    pub fn config_string(&self, repo: &Repository, key: &str) -> Option<String> {
        if let Some((_, v)) = self
            .config
            .iter()
            .rev()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
        {
            return Some(v.clone());
        }
        repo.config().ok()?.get_string(key).ok()
    }

    pub fn config_bool(&self, repo: &Repository, key: &str) -> bool {
        match self.config_string(repo, key) {
            Some(v) => matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "true" | "yes" | "on" | "1"
            ),
            None => false,
        }
    }

    fn env_var(&self, key: &str) -> Option<&str> {
        self.env
            .iter()
            .rev()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
            .filter(|v| !v.is_empty())
    }

    /// Committer identity: `GIT_COMMITTER_*`, then `user.*`.
    pub fn committer(&self, repo: &Repository) -> Result<Signature<'static>, CliOutput> {
        self.identity(repo, "COMMITTER")
    }

    /// Author identity: `GIT_AUTHOR_*`, then `user.*`.
    pub fn author(&self, repo: &Repository) -> Result<Signature<'static>, CliOutput> {
        self.identity(repo, "AUTHOR")
    }

    fn identity(&self, repo: &Repository, who: &str) -> Result<Signature<'static>, CliOutput> {
        let name = self
            .env_var(&format!("GIT_{who}_NAME"))
            .map(str::to_string)
            .or_else(|| self.config_string(repo, "user.name"))
            .filter(|n| !n.trim().is_empty());
        let email = self
            .env_var(&format!("GIT_{who}_EMAIL"))
            .map(str::to_string)
            .or_else(|| self.config_string(repo, "user.email"))
            .filter(|n| !n.trim().is_empty());
        let (Some(name), Some(email)) = (name, email) else {
            return Err(fail(
                128,
                "Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config user.email \"you@example.com\"\n  git config user.name \"Your Name\"\n\nto set your account's default identity.\n\nfatal: unable to auto-detect email address",
            ));
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        Signature::new(&name, &email, &Time::new(now, 0))
            .map_err(|e| fail(128, &format!("fatal: invalid identity: {}", e.message())))
    }
}

/// Exit 0 with `stdout`.
pub fn ok(stdout: impl Into<String>) -> CliOutput {
    CliOutput {
        stdout: stdout.into().into_bytes(),
        stderr: String::new(),
        code: 0,
    }
}

/// Non-zero exit with `stderr` (a trailing newline is added).
pub fn fail(code: i32, stderr: &str) -> CliOutput {
    CliOutput {
        stdout: Vec::new(),
        stderr: format!("{}\n", stderr.trim_end_matches('\n')),
        code,
    }
}

/// The "not supported here" result for `git <args...>`.
pub fn unsupported(args: &[String]) -> CliOutput {
    fail(1, &format!("{UNSUPPORTED_PREFIX} git {}", args.join(" ")))
}

/// Serves one git invocation in-process.
pub fn run(
    dir: &Path,
    args: &[String],
    opts: &CliOptions,
    _op: Option<&OpHandle>,
    on_stderr: &mut dyn FnMut(&str),
) -> AppResult<CliOutput> {
    let out = match dispatch(dir, args, opts) {
        Ok(out) => out,
        Err(e) => fail(128, &format!("fatal: {}", e.message)),
    };
    for line in out.stderr.lines() {
        on_stderr(line);
    }
    Ok(out)
}

fn dispatch(dir: &Path, args: &[String], opts: &CliOptions) -> Res {
    let mut ctx = Ctx {
        dir: dir.to_path_buf(),
        stdin: opts.stdin.clone(),
        config: Vec::new(),
        env: opts.env.clone(),
    };
    // Global options.
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-c" => {
                let Some(kv) = args.get(i + 1) else {
                    return Ok(fail(129, "error: switch `c' requires a value"));
                };
                let (k, v) = kv.split_once('=').unwrap_or((kv.as_str(), "true"));
                ctx.config.push((k.to_string(), v.to_string()));
                i += 2;
            }
            "-C" => {
                let Some(p) = args.get(i + 1) else {
                    return Ok(fail(129, "error: switch `C' requires a value"));
                };
                ctx.dir = ctx.dir.join(p);
                i += 2;
            }
            "--no-pager" | "--no-optional-locks" | "--literal-pathspecs" => i += 1,
            _ => break,
        }
    }
    let rest = &args[i..];
    let Some(cmd) = rest.first() else {
        return Ok(fail(1, "usage: git [-c <name>=<value>] <command> [<args>]"));
    };
    let a = &rest[1..];
    match cmd.as_str() {
        "--version" | "version" => {
            let (a, b, c) = git2::Version::get().libgit2_version();
            Ok(ok(format!("git version 2.50.0 (libgit2 {a}.{b}.{c})\n")))
        }
        "commit" => commit::run(&ctx, a),
        "stash" => stash::run(&ctx, a),
        "merge" => merge::run(&ctx, a),
        "cherry-pick" => pick::run(&ctx, pick::Kind::CherryPick, a),
        "revert" => pick::run(&ctx, pick::Kind::Revert, a),
        "reset" => reset::run(&ctx, a),
        "switch" => switch::run(&ctx, a),
        "add" | "rm" => conflicts::run(&ctx, cmd, a),
        "rebase" => rebase::run(&ctx, a),
        "worktree" => worktree::run(&ctx, a),
        "log" => log::run(&ctx, a),
        _ => Ok(unsupported(rest)),
    }
}

// ------------------------------------------------------------------ shared

/// Splits `args` at the first `--`.
pub(super) fn split_dashdash(args: &[String]) -> (&[String], &[String]) {
    match args.iter().position(|a| a == "--") {
        Some(p) => (&args[..p], &args[p + 1..]),
        None => (args, &[]),
    }
}

/// git's "whitespace" cleanup: trims trailing whitespace on every line,
/// drops leading/trailing blank lines, collapses runs of blank lines and
/// ends with exactly one newline.
pub(super) fn clean_message(msg: &str, strip_comments: bool) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut blank = false;
    let normalized = msg.replace("\r\n", "\n");
    for line in normalized.lines() {
        if strip_comments && line.starts_with('#') {
            continue;
        }
        let line = line.trim_end();
        if line.is_empty() {
            blank = true;
            continue;
        }
        if blank && !out.is_empty() {
            out.push("");
        }
        blank = false;
        out.push(line);
    }
    if out.is_empty() {
        return String::new();
    }
    let mut s = out.join("\n");
    s.push('\n');
    s
}

/// Path of a file inside the git directory.
pub(super) fn git_file(repo: &Repository, name: &str) -> PathBuf {
    repo.path().join(name)
}

/// Removes a state file, ignoring "does not exist".
pub(super) fn remove_state_file(repo: &Repository, name: &str) {
    let _ = std::fs::remove_file(git_file(repo, name));
}

/// Drops the per-commit state of a cherry-pick / revert (not the sequencer
/// directory, which spans several commits).
pub(super) fn clear_pick_state(repo: &Repository) {
    for f in ["CHERRY_PICK_HEAD", "REVERT_HEAD", "MERGE_MSG", "MERGE_MODE"] {
        remove_state_file(repo, f);
    }
}

/// Files a safe checkout refused to overwrite, as git words it: "...
/// overwritten by `by`: ... before you `before`".
pub(super) fn overwritten_message(files: &[String], by: &str, before: &str) -> String {
    let mut s =
        format!("error: Your local changes to the following files would be overwritten by {by}:\n");
    for f in files {
        s.push_str(&format!("\t{f}\n"));
    }
    s.push_str(&format!(
        "Please commit your changes or stash them before you {before}.\nAborting"
    ));
    s
}

/// Safe checkout of `tree` into the working tree and index. On refusal
/// returns the conflicting paths.
pub(super) fn checkout_safe(
    repo: &Repository,
    tree: &git2::Object<'_>,
) -> AppResult<Result<(), Vec<String>>> {
    use std::cell::RefCell;
    let conflicts = RefCell::new(Vec::<String>::new());
    let result = {
        let mut co = git2::build::CheckoutBuilder::new();
        co.safe();
        co.notify_on(git2::CheckoutNotificationType::CONFLICT);
        co.notify(|_, path, _, _, _| {
            if let Some(p) = path {
                conflicts
                    .borrow_mut()
                    .push(p.to_string_lossy().replace('\\', "/"));
            }
            true
        });
        repo.checkout_tree(tree, Some(&mut co))
    };
    match result {
        Ok(()) => Ok(Ok(())),
        Err(e)
            if matches!(
                e.code(),
                git2::ErrorCode::Conflict | git2::ErrorCode::Uncommitted
            ) =>
        {
            Ok(Err(conflicts.into_inner()))
        }
        Err(e) => Err(e.into()),
    }
}

/// Moves the current branch (or a detached HEAD) to `oid` without touching
/// the working tree.
pub(super) fn move_head(repo: &Repository, oid: git2::Oid, log: &str) -> AppResult<()> {
    let head = repo.find_reference("HEAD")?;
    match head.symbolic_target().ok().flatten() {
        Some(name) => {
            repo.reference(name, oid, true, log)?;
        }
        None => repo.set_head_detached(oid)?,
    }
    Ok(())
}

/// Whether the index differs from HEAD (staged changes).
pub(super) fn staged_changes(repo: &Repository) -> AppResult<bool> {
    let head_tree = match repo.head() {
        Ok(h) => Some(h.peel_to_tree()?),
        Err(_) => None,
    };
    let diff = repo.diff_tree_to_index(head_tree.as_ref(), None, None)?;
    Ok(diff.deltas().len() > 0)
}

/// `CONFLICT (...)` lines for the conflicts in `index`, as git prints them.
pub(super) fn conflict_lines(index: &git2::Index, theirs_label: &str) -> AppResult<String> {
    let mut lines: Vec<(String, String)> = Vec::new();
    for c in index.conflicts()? {
        let c = c?;
        let path = c
            .our
            .as_ref()
            .or(c.their.as_ref())
            .or(c.ancestor.as_ref())
            .map(|e| String::from_utf8_lossy(&e.path).into_owned())
            .unwrap_or_default();
        let line = match (c.ancestor.is_some(), c.our.is_some(), c.their.is_some()) {
            (true, true, false) => format!(
                "CONFLICT (modify/delete): {path} deleted in {theirs_label} and modified in HEAD.  Version HEAD of {path} left in tree."
            ),
            (true, false, true) => format!(
                "CONFLICT (modify/delete): {path} deleted in HEAD and modified in {theirs_label}.  Version {theirs_label} of {path} left in tree."
            ),
            (false, true, true) => format!("CONFLICT (add/add): Merge conflict in {path}"),
            _ => format!("CONFLICT (content): Merge conflict in {path}"),
        };
        lines.push((path, line));
    }
    lines.sort();
    lines.dedup();
    Ok(lines
        .into_iter()
        .map(|(_, l)| l)
        .collect::<Vec<_>>()
        .join("\n"))
}
