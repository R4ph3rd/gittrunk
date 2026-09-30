//! libgit2 network backend for embedded builds (no git CLI, no askpass
//! re-exec). Credentials come from a `CredentialResolver`, progress goes to
//! the session's sink, cancellation is honored in the transfer callbacks.
//!
//! The functions here are compiled on every platform; `enabled()` decides
//! whether `net.rs` routes to them.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::Path;

use git2::build::RepoBuilder;
use git2::{
    AutotagOption, BranchType, Cred, CredentialType, Direction, ErrorClass, ErrorCode,
    FetchOptions, FetchPrune, Oid, PushOptions, RemoteCallbacks, Repository,
    SubmoduleUpdateOptions,
};

use super::creds::{host_port, user_of};
use super::net::{self, NetSession};
use super::progress::{parse_progress, Progress};
use super::validate;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

/// Whether network operations run through libgit2.
pub fn enabled() -> bool {
    cfg!(embedded_git)
}

const SSH_UNSUPPORTED: &str =
    "SSH remotes are not supported on this platform; use an HTTPS URL with a personal access token";
const MAX_AUTH_ATTEMPTS: u32 = 3;

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

// --------------------------------------------------------------- errors

/// Error kind for a libgit2 failure.
pub fn classify_git2_error(e: &git2::Error) -> ErrorKind {
    let msg = e.message().to_ascii_lowercase();
    if e.code() == ErrorCode::User {
        return ErrorKind::Cancelled;
    }
    if e.code() == ErrorCode::Auth
        || msg.contains("authentication required")
        || msg.contains("too many redirects or authentication replays")
    {
        return ErrorKind::AuthFailed;
    }
    if e.code() == ErrorCode::Certificate
        || matches!(
            e.class(),
            ErrorClass::Net | ErrorClass::Http | ErrorClass::Ssl
        )
    {
        return ErrorKind::Network;
    }
    let has = |needles: &[&str]| needles.iter().any(|n| msg.contains(n));
    if has(&[
        "failed to resolve address",
        "could not resolve host",
        "connection refused",
        "connection reset",
        "timed out",
        "network is unreachable",
        "failed to connect",
        "certificate",
    ]) {
        ErrorKind::Network
    } else {
        ErrorKind::GitCli
    }
}

/// `AppError` for a libgit2 failure; certificate text goes into `detail`.
pub fn git2_error(e: &git2::Error) -> AppError {
    let kind = classify_git2_error(e);
    let err = AppError::new(kind, e.message().to_string());
    let is_cert = e.code() == ErrorCode::Certificate
        || e.class() == ErrorClass::Ssl
        || e.message().to_ascii_lowercase().contains("certificate");
    if kind == ErrorKind::Network && is_cert {
        err.with_detail(e.message().to_string())
    } else {
        err
    }
}

fn cancelled(sess: &NetSession) -> bool {
    sess.op.as_ref().is_some_and(|o| o.is_cancelled())
}

fn check_cancel(sess: &NetSession) -> AppResult<()> {
    if cancelled(sess) {
        Err(AppError::new(ErrorKind::Cancelled, "operation cancelled"))
    } else {
        Ok(())
    }
}

// --------------------------------------------------------------- hooks

#[derive(Default)]
pub(super) struct CredState {
    attempts: u32,
    /// Username used for the previous attempt.
    user: Option<String>,
}

/// Callback state shared by all transfers of one operation.
pub(super) struct Hooks<'a> {
    sess: &'a NetSession,
    /// The real reason a callback aborted the transfer (libgit2 only reports
    /// a generic user error then).
    failure: RefCell<Option<AppError>>,
    /// Push rejections reported by the remote.
    rejected: RefCell<Vec<String>>,
    /// Credentials handed out so far, per host, so a second connection of the
    /// same operation (push after the lease check) does not prompt again.
    cache: RefCell<HashMap<String, (String, String)>>,
}

fn human_bytes(b: usize) -> String {
    let b = b as f64;
    if b >= 1024.0 * 1024.0 {
        format!("{:.1} MiB", b / (1024.0 * 1024.0))
    } else if b >= 1024.0 {
        format!("{:.1} KiB", b / 1024.0)
    } else {
        format!("{b:.0} B")
    }
}

fn pct(done: usize, total: usize) -> Option<f64> {
    (total > 0).then(|| (done as f64 / total as f64 * 100.0).clamp(0.0, 100.0))
}

impl<'a> Hooks<'a> {
    pub(super) fn new(sess: &'a NetSession) -> Self {
        Self {
            sess,
            failure: RefCell::new(None),
            rejected: RefCell::new(Vec::new()),
            cache: RefCell::new(HashMap::new()),
        }
    }

    fn fail(&self, err: AppError) -> git2::Error {
        let msg = err.message.clone();
        *self.failure.borrow_mut() = Some(err);
        git2::Error::from_str(&msg)
    }

    /// Turns a libgit2 error into ours, preferring the recorded reason.
    pub(super) fn convert(&self, e: git2::Error) -> AppError {
        if let Some(err) = self.failure.borrow_mut().take() {
            return err;
        }
        if cancelled(self.sess) {
            return AppError::new(ErrorKind::Cancelled, "operation cancelled");
        }
        git2_error(&e)
    }

    fn callbacks(&'a self) -> RemoteCallbacks<'a> {
        let mut cb = RemoteCallbacks::new();
        let mut state = CredState::default();
        cb.credentials(move |url, user, allowed| self.credentials(url, user, allowed, &mut state));
        cb.transfer_progress(|p| {
            let received = p.received_objects();
            let total = p.total_objects();
            let progress = if p.total_deltas() > 0 && received >= total {
                Progress {
                    phase: "Resolving deltas".into(),
                    percent: pct(p.indexed_deltas(), p.total_deltas()),
                    message: format!("{}/{}", p.indexed_deltas(), p.total_deltas()),
                }
            } else {
                Progress {
                    phase: "Receiving objects".into(),
                    percent: pct(received, total),
                    message: format!("{received}/{total}, {}", human_bytes(p.received_bytes())),
                }
            };
            self.sess.report(progress);
            !cancelled(self.sess)
        });
        cb.sideband_progress(|data| {
            let text = String::from_utf8_lossy(data);
            for line in text.split(['\r', '\n']) {
                if let Some(p) = parse_progress(line) {
                    self.sess.report(p);
                }
            }
            !cancelled(self.sess)
        });
        cb.pack_progress(|stage, current, total| {
            let phase = match stage {
                git2::PackBuilderStage::AddingObjects => "Counting objects",
                git2::PackBuilderStage::Deltafication => "Compressing objects",
            };
            self.sess.report(Progress {
                phase: phase.into(),
                percent: pct(current, total),
                message: format!("{current}/{total}"),
            });
        });
        cb.push_transfer_progress(|current, total, bytes| {
            self.sess.report(Progress {
                phase: "Writing objects".into(),
                percent: pct(current, total),
                message: format!("{current}/{total}, {}", human_bytes(bytes)),
            });
        });
        cb.push_negotiation(|_| {
            if cancelled(self.sess) {
                Err(self.fail(AppError::new(ErrorKind::Cancelled, "operation cancelled")))
            } else {
                Ok(())
            }
        });
        cb.push_update_reference(|name, status| {
            if let Some(msg) = status {
                self.rejected.borrow_mut().push(format!("{name}: {msg}"));
            }
            Ok(())
        });
        cb
    }

    pub(super) fn credentials(
        &self,
        url: &str,
        user_from_url: Option<&str>,
        allowed: CredentialType,
        st: &mut CredState,
    ) -> Result<Cred, git2::Error> {
        let ssh = CredentialType::SSH_KEY
            | CredentialType::SSH_CUSTOM
            | CredentialType::SSH_INTERACTIVE
            | CredentialType::SSH_MEMORY;
        if allowed.intersects(ssh)
            || (allowed.contains(CredentialType::USERNAME)
                && !allowed.contains(CredentialType::USER_PASS_PLAINTEXT))
        {
            return Err(self.fail(AppError::new(ErrorKind::Unsupported, SSH_UNSUPPORTED)));
        }
        if !allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            return Err(self.fail(AppError::new(
                ErrorKind::AuthFailed,
                "the server offers no supported authentication method",
            )));
        }
        let Some(resolver) = self.sess.resolver.clone() else {
            return Err(self.fail(AppError::new(
                ErrorKind::AuthRequired,
                "the remote requires authentication",
            )));
        };
        st.attempts += 1;
        if st.attempts > MAX_AUTH_ATTEMPTS {
            return Err(self.fail(AppError::new(
                ErrorKind::AuthFailed,
                "authentication failed",
            )));
        }
        check_cancel(self.sess).map_err(|e| self.fail(e))?;

        let host = host_port(url);
        let first = st.attempts == 1;
        if first {
            if let Some((u, p)) = self.cache.borrow().get(&host).cloned() {
                st.user = Some(u.clone());
                return Cred::userpass_plaintext(&u, &p);
            }
        } else {
            self.cache.borrow_mut().remove(&host);
            if let Some(prev) = &st.user {
                resolver.forget(&host, prev);
            }
        }
        let url_user = user_from_url.map(str::to_string).or_else(|| user_of(url));
        let user = match url_user {
            Some(u) => Some(u),
            None if first => resolver.ask(CredentialKind::Username, &host, url, None),
            None => resolver.ask_ui(CredentialKind::Username, &host, url, None),
        };
        let secret = user.as_deref().and_then(|u| {
            if first {
                resolver.ask(CredentialKind::Password, &host, url, Some(u))
            } else {
                resolver.ask_ui(CredentialKind::Password, &host, url, Some(u))
            }
        });
        match (user, secret) {
            (Some(u), Some(p)) => {
                st.user = Some(u.clone());
                self.cache.borrow_mut().insert(host, (u.clone(), p.clone()));
                Cred::userpass_plaintext(&u, &p)
            }
            _ => {
                let err = if cancelled(self.sess) {
                    AppError::new(ErrorKind::Cancelled, "operation cancelled")
                } else {
                    AppError::new(ErrorKind::AuthRequired, "credentials were not provided")
                };
                Err(self.fail(err))
            }
        }
    }
}

// --------------------------------------------------------------- fetch

pub fn fetch(sess: &NetSession, dir: &Path, request: &FetchRequest) -> AppResult<()> {
    net::fetch_args(request)?; // validation shared with the CLI path
    check_cancel(sess)?;
    let repo = Repository::open(dir)?;
    let names: Vec<String> = match &request.remote {
        Some(r) => vec![r.clone()],
        None => repo
            .remotes()?
            .iter()
            .flatten()
            .flatten()
            .map(str::to_string)
            .collect(),
    };
    let hooks = Hooks::new(sess);
    for name in names {
        fetch_remote(&hooks, &repo, &name, &[], request.prune, request.tags)?;
    }
    Ok(())
}

fn fetch_remote(
    hooks: &Hooks<'_>,
    repo: &Repository,
    name: &str,
    refspecs: &[String],
    prune: bool,
    tags: bool,
) -> AppResult<()> {
    check_cancel(hooks.sess)?;
    let mut remote = repo.find_remote(name).map_err(|e| git2_error(&e))?;
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(hooks.callbacks());
    if prune {
        opts.prune(FetchPrune::On);
    }
    if tags {
        opts.download_tags(AutotagOption::All);
    }
    let result = remote.fetch(refspecs, Some(&mut opts), None);
    let _ = remote.disconnect();
    result.map_err(|e| hooks.convert(e))
}

// --------------------------------------------------------------- pull

fn current_branch(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if head.is_branch() {
        head.shorthand().ok().map(str::to_string)
    } else {
        None
    }
}

/// `(remote, branch, explicit_branch)` for a pull request.
fn pull_target(repo: &Repository, request: &PullRequest) -> AppResult<(String, String, bool)> {
    match (&request.remote, &request.branch) {
        (Some(r), Some(b)) => Ok((r.clone(), b.clone(), true)),
        (None, Some(b)) => Ok(("origin".to_string(), b.clone(), true)),
        (remote, None) => {
            let cur = current_branch(repo).ok_or_else(|| {
                invalid("not on a branch; choose a remote and branch to pull from")
            })?;
            let cfg = repo.config()?;
            let up_remote = cfg.get_string(&format!("branch.{cur}.remote")).ok();
            let up_branch = cfg
                .get_string(&format!("branch.{cur}.merge"))
                .ok()
                .and_then(|m| m.strip_prefix("refs/heads/").map(str::to_string));
            let remote = remote
                .clone()
                .or_else(|| up_remote.clone().filter(|r| r != "."))
                .unwrap_or_else(|| "origin".to_string());
            let branch = match (&up_remote, up_branch) {
                (Some(r), Some(b)) if *r == remote => b,
                _ => cur,
            };
            Ok((remote, branch, false))
        }
    }
}

fn fetch_head_oid(repo: &Repository, branch: &str) -> Option<Oid> {
    let want = format!("refs/heads/{branch}");
    let mut found = None;
    let _ = repo.fetchhead_foreach(|name, _, oid, _| {
        if name == want && found.is_none() {
            found = Some(*oid);
        }
        true
    });
    found
}

/// Fetches what a pull needs and returns the git arguments of the merge step
/// (`None` when already up to date). The dialect is fixed: R1b-1/R1b-2
/// implement exactly these commands.
pub fn pull_prepare(
    sess: &NetSession,
    repo: &Repository,
    request: &PullRequest,
) -> AppResult<Option<Vec<String>>> {
    check_cancel(sess)?;
    let (remote_name, branch, explicit) = pull_target(repo, request)?;
    validate::remote_name(&remote_name)?;
    validate::branch(&branch)?;
    let hooks = Hooks::new(sess);
    let refspecs = if explicit {
        vec![format!("refs/heads/{branch}")]
    } else {
        Vec::new()
    };
    fetch_remote(&hooks, repo, &remote_name, &refspecs, false, false)?;

    let tracking = format!("refs/remotes/{remote_name}/{branch}");
    let oid = if explicit {
        fetch_head_oid(repo, &branch)
    } else {
        None
    }
    .or_else(|| repo.refname_to_id(&tracking).ok())
    .or_else(|| fetch_head_oid(repo, &branch))
    .ok_or_else(|| {
        AppError::new(
            ErrorKind::RefNotFound,
            format!("couldn't find remote ref `{branch}` on `{remote_name}`"),
        )
    })?;

    let head = repo.head().ok().and_then(|h| h.target());
    if let Some(head) = head {
        if head == oid || repo.graph_descendant_of(head, oid).unwrap_or(false) {
            return Ok(None);
        }
    }
    let oid = oid.to_string();
    let url = repo
        .find_remote(&remote_name)
        .map_err(|e| git2_error(&e))?
        .url()
        .unwrap_or_default()
        .to_string();
    let args: Vec<String> = match request.strategy {
        PullStrategy::Merge => vec![
            "merge".into(),
            "--no-edit".into(),
            "-m".into(),
            format!("Merge branch '{branch}' of {url}"),
            oid,
        ],
        PullStrategy::FfOnly => vec!["merge".into(), "--no-edit".into(), "--ff-only".into(), oid],
        // R1b-2 implements `rebase <oid>` in the shim.
        PullStrategy::Rebase => vec!["rebase".into(), oid],
    };
    Ok(Some(args))
}

// --------------------------------------------------------------- push

struct Spec {
    /// Full local ref; `None` deletes `dst`.
    src: Option<String>,
    dst: String,
}

impl Spec {
    fn text(&self, force: bool) -> String {
        match &self.src {
            Some(src) => format!("{}{src}:{}", if force { "+" } else { "" }, self.dst),
            None => format!(":{}", self.dst),
        }
    }
}

fn resolve_local(repo: &Repository, name: &str) -> AppResult<String> {
    if name == "HEAD" {
        let head = repo.head()?;
        return (if head.is_branch() {
            head.name().ok().map(str::to_string)
        } else {
            None
        })
        .ok_or_else(|| invalid("HEAD is detached; push an explicit `src:dst` refspec"));
    }
    for candidate in [
        name.to_string(),
        format!("refs/heads/{name}"),
        format!("refs/tags/{name}"),
    ] {
        if candidate.starts_with("refs/") && repo.find_reference(&candidate).is_ok() {
            return Ok(candidate);
        }
    }
    Err(invalid(format!("src refspec `{name}` does not match any")))
}

fn expand_specs(repo: &Repository, request: &PushRequest) -> AppResult<Vec<Spec>> {
    let mut out = Vec::new();
    if request.refspecs.is_empty() && !request.tags {
        let cur =
            current_branch(repo).ok_or_else(|| invalid("not on a branch; choose what to push"))?;
        let full = format!("refs/heads/{cur}");
        out.push(Spec {
            src: Some(full.clone()),
            dst: full,
        });
    }
    for s in &request.refspecs {
        match s.split_once(':') {
            None => {
                let full = resolve_local(repo, s)?;
                out.push(Spec {
                    src: Some(full.clone()),
                    dst: full,
                });
            }
            Some(("", dst)) => out.push(Spec {
                src: None,
                dst: if dst.starts_with("refs/") {
                    dst.to_string()
                } else {
                    format!("refs/heads/{dst}")
                },
            }),
            Some((src, dst)) => {
                let full = resolve_local(repo, src)?;
                let dst = if dst.starts_with("refs/") {
                    dst.to_string()
                } else if full.starts_with("refs/tags/") {
                    format!("refs/tags/{dst}")
                } else {
                    format!("refs/heads/{dst}")
                };
                out.push(Spec {
                    src: Some(full),
                    dst,
                });
            }
        }
    }
    if request.tags {
        for tag in repo.tag_names(None)?.iter().flatten().flatten() {
            let full = format!("refs/tags/{tag}");
            out.push(Spec {
                src: Some(full.clone()),
                dst: full,
            });
        }
    }
    Ok(out)
}

pub fn push(sess: &NetSession, dir: &Path, request: &PushRequest) -> AppResult<()> {
    net::push_args(request)?; // validation shared with the CLI path
    check_cancel(sess)?;
    let repo = Repository::open(dir)?;
    let specs = expand_specs(&repo, request)?;
    push_specs(
        sess,
        &repo,
        &request.remote,
        &specs,
        request.force_with_lease,
        request.set_upstream,
    )
}

/// Deletes `branch` on `remote` (`git push --delete`).
pub fn delete_remote_branch(
    sess: &NetSession,
    repo: &Repository,
    remote: &str,
    branch: &str,
) -> AppResult<()> {
    check_cancel(sess)?;
    let specs = [Spec {
        src: None,
        dst: format!("refs/heads/{branch}"),
    }];
    push_specs(sess, repo, remote, &specs, false, false)
}

fn push_specs(
    sess: &NetSession,
    repo: &Repository,
    remote_name: &str,
    specs: &[Spec],
    lease: bool,
    set_upstream: bool,
) -> AppResult<()> {
    if specs.is_empty() {
        return Ok(());
    }
    let hooks = Hooks::new(sess);
    let mut remote = repo.find_remote(remote_name).map_err(|e| git2_error(&e))?;

    let texts: Vec<String> = specs.iter().map(|s| s.text(lease)).collect();
    let mut opts = PushOptions::new();
    opts.remote_callbacks(hooks.callbacks());
    let result = if lease {
        // Lease: what the remote advertises must be what we last fetched.
        let mut conn = remote
            .connect_auth(Direction::Push, Some(hooks.callbacks()), None)
            .map_err(|e| hooks.convert(e))?;
        let advertised: HashMap<String, Oid> = conn
            .list()?
            .iter()
            .map(|h| (h.name().to_string(), h.oid()))
            .collect();
        check_lease(repo, remote_name, specs, &advertised)?;
        conn.remote().push(&texts, Some(&mut opts))
    } else {
        remote.push(&texts, Some(&mut opts))
    };
    result.map_err(|e| hooks.convert(e))?;
    let rejected = hooks.rejected.take();
    if !rejected.is_empty() {
        let first = rejected[0].clone();
        return Err(
            AppError::new(ErrorKind::GitCli, format!("rejected: {first}"))
                .with_detail(rejected.join("\n")),
        );
    }
    after_push(repo, remote_name, specs, set_upstream)
}

fn check_lease(
    repo: &Repository,
    remote_name: &str,
    specs: &[Spec],
    advertised: &HashMap<String, Oid>,
) -> AppResult<()> {
    for spec in specs.iter().filter(|s| s.src.is_some()) {
        let Some(branch) = spec.dst.strip_prefix("refs/heads/") else {
            continue;
        };
        let actual = advertised.get(&spec.dst).copied();
        let expected = repo
            .refname_to_id(&format!("refs/remotes/{remote_name}/{branch}"))
            .ok();
        if actual != expected {
            let show = |o: Option<Oid>, none: &str| o.map_or(none.to_string(), |o| o.to_string());
            return Err(
                AppError::new(ErrorKind::GitCli, format!("{} (stale info)", spec.dst)).with_detail(
                    format!(
                        "the remote `{remote_name}` has {} for `{branch}` but the last fetched value is {}; fetch first",
                        show(actual, "no such branch"),
                        show(expected, "unknown"),
                    ),
                ),
            );
        }
    }
    Ok(())
}

/// Mirrors what `git push` does locally: remote-tracking refs follow the
/// push, and `-u` records the upstream.
fn after_push(
    repo: &Repository,
    remote_name: &str,
    specs: &[Spec],
    set_upstream: bool,
) -> AppResult<()> {
    for spec in specs {
        let Some(branch) = spec.dst.strip_prefix("refs/heads/") else {
            continue;
        };
        let tracking = format!("refs/remotes/{remote_name}/{branch}");
        match &spec.src {
            None => {
                if let Ok(mut r) = repo.find_reference(&tracking) {
                    let _ = r.delete();
                }
            }
            Some(src) => {
                let oid = repo.refname_to_id(src)?;
                repo.reference(&tracking, oid, true, "push")?;
                if set_upstream {
                    if let Some(local) = src.strip_prefix("refs/heads/") {
                        set_branch_upstream(repo, local, remote_name, branch)?;
                    }
                }
            }
        }
    }
    Ok(())
}

fn set_branch_upstream(
    repo: &Repository,
    local: &str,
    remote_name: &str,
    branch: &str,
) -> AppResult<()> {
    let mut b = repo.find_branch(local, BranchType::Local)?;
    if b.set_upstream(Some(&format!("{remote_name}/{branch}")))
        .is_ok()
    {
        return Ok(());
    }
    // The remote has no fetch refspec covering the branch: write the config.
    let mut cfg = repo.config()?;
    cfg.set_str(&format!("branch.{local}.remote"), remote_name)?;
    cfg.set_str(
        &format!("branch.{local}.merge"),
        &format!("refs/heads/{branch}"),
    )?;
    Ok(())
}

// --------------------------------------------------------------- clone

/// Clones `request.url` into `dest` (validated, parent exists). The caller
/// cleans the destination up on failure.
pub fn clone_into(sess: &NetSession, request: &CloneRequest, dest: &Path) -> AppResult<()> {
    check_cancel(sess)?;
    sess.report(Progress {
        phase: "Cloning".into(),
        percent: None,
        message: format!("Cloning into '{}'", dest.display()),
    });
    let hooks = Hooks::new(sess);
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(hooks.callbacks());
    let mut builder = RepoBuilder::new();
    builder.bare(request.bare).fetch_options(opts);
    let repo = builder
        .clone(&request.url, dest)
        .map_err(|e| hooks.convert(e))?;
    if request.recurse_submodules && !request.bare {
        update_submodules(&hooks, &repo, 0)?;
    }
    Ok(())
}

/// Best effort: a submodule that cannot be fetched does not fail the clone,
/// cancellation does.
fn update_submodules(hooks: &Hooks<'_>, repo: &Repository, depth: u32) -> AppResult<()> {
    let Ok(subs) = repo.submodules() else {
        return Ok(());
    };
    for mut sm in subs {
        check_cancel(hooks.sess)?;
        let mut fetch = FetchOptions::new();
        fetch.remote_callbacks(hooks.callbacks());
        let mut opts = SubmoduleUpdateOptions::new();
        opts.fetch(fetch);
        if sm.update(true, Some(&mut opts)).is_err() {
            check_cancel(hooks.sess)?;
            continue;
        }
        if depth < 4 {
            if let Ok(sub) = sm.open() {
                update_submodules(hooks, &sub, depth + 1)?;
            }
        }
    }
    Ok(())
}
