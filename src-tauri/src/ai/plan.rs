//! Natural-language plans: strict parsing of the model's JSON, validation of
//! every step against the repository, a combined dry-run preview, an
//! in-memory plan store and sequential execution through the existing
//! services (never a shell).

use std::collections::{HashSet, VecDeque};
use std::hash::{BuildHasher, Hasher};
use std::sync::{Mutex, OnceLock};

use git2::{BranchType, Repository};
use serde::Deserialize;
use serde_json::Value;

use crate::git::cli::GitCli;
use crate::git::history::HistoryService;
use crate::git::libgit::repo::head_state;
use crate::git::libgit::LibGit;
use crate::git::refs_write::RefWriteService;
use crate::git::remote::net::{self, NetSession};
use crate::git::stash_write::StashWriteService;
use crate::git::GitState;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub const MAX_STEPS: usize = 10;
const MAX_STORED: usize = 32;

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

fn bad_output(msg: impl AsRef<str>) -> AppError {
    AppError::new(
        ErrorKind::AiProvider,
        format!("The assistant returned an unusable plan: {}", msg.as_ref()),
    )
}

// ------------------------------------------------------------------ parsing

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPlan {
    explanation: String,
    steps: Vec<RawStep>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawStep {
    description: String,
    command: Value,
}

#[derive(Debug)]
pub struct ParsedPlan {
    pub explanation: String,
    pub steps: Vec<PlannedStep>,
}

/// Strips a single surrounding Markdown code fence, if any.
pub fn strip_fences(text: &str) -> &str {
    let t = text.trim();
    if let Some(rest) = t.strip_prefix("```") {
        let rest = rest.split_once('\n').map(|(_, r)| r).unwrap_or(rest);
        if let Some(inner) = rest.trim_end().strip_suffix("```") {
            return inner.trim();
        }
    }
    t
}

/// True when every key present in `input` is also present in `canonical`
/// (recursively). `canonical` is the serialization of the parsed command, so
/// this rejects fields serde would silently ignore.
fn no_extra_keys(input: &Value, canonical: &Value) -> bool {
    match (input, canonical) {
        (Value::Object(i), Value::Object(c)) => i
            .iter()
            .all(|(k, v)| c.get(k).is_some_and(|cv| no_extra_keys(v, cv))),
        (Value::Array(i), Value::Array(c)) => {
            i.len() == c.len() && i.iter().zip(c).all(|(a, b)| no_extra_keys(a, b))
        }
        _ => true,
    }
}

fn parse_command(value: &Value) -> AppResult<PlannedCommand> {
    let cmd: PlannedCommand = serde_json::from_value(value.clone()).map_err(|e| {
        let kind = value.get("kind").and_then(Value::as_str).unwrap_or("?");
        bad_output(format!("unsupported or malformed command `{kind}` ({e})"))
    })?;
    let canonical = serde_json::to_value(&cmd).map_err(|e| bad_output(e.to_string()))?;
    if !no_extra_keys(value, &canonical) {
        return Err(bad_output("a command contains unknown fields"));
    }
    Ok(cmd)
}

/// Parses the model's reply. Strict: unknown kinds and unknown fields are
/// rejected, and at most `MAX_STEPS` steps are accepted.
pub fn parse(text: &str) -> AppResult<ParsedPlan> {
    let raw: RawPlan = serde_json::from_str(strip_fences(text))
        .map_err(|e| bad_output(format!("not the expected JSON shape ({e})")))?;
    if raw.steps.len() > MAX_STEPS {
        return Err(bad_output(format!(
            "{} steps exceed the limit of {MAX_STEPS}",
            raw.steps.len()
        )));
    }
    let steps = raw
        .steps
        .into_iter()
        .map(|s| {
            Ok(PlannedStep {
                description: s.description.trim().to_string(),
                command: parse_command(&s.command)?,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok(ParsedPlan {
        explanation: raw.explanation.trim().to_string(),
        steps,
    })
}

// --------------------------------------------------------------- validation

struct Checker<'r> {
    repo: &'r Repository,
    /// Branches and tags created by earlier steps of the plan.
    created: HashSet<String>,
}

impl Checker<'_> {
    fn spec(&self, spec: &str, what: &str) -> AppResult<()> {
        if spec.trim().is_empty() || spec.starts_with('-') || spec.chars().any(char::is_control) {
            return Err(invalid(format!("{what} `{spec}` is not a valid revision")));
        }
        if self.created.contains(spec) || self.repo.revparse_single(spec).is_ok() {
            Ok(())
        } else {
            Err(AppError::new(
                ErrorKind::RefNotFound,
                format!("{what} `{spec}` does not exist"),
            ))
        }
    }

    fn branch_name(&self, name: &str) -> AppResult<()> {
        if git2::Branch::name_is_valid(name).unwrap_or(false) && !name.starts_with('-') {
            Ok(())
        } else {
            Err(invalid(format!("`{name}` is not a valid branch name")))
        }
    }

    fn existing_branch(&self, name: &str) -> AppResult<()> {
        self.branch_name(name)?;
        if self.created.contains(name) || self.repo.find_branch(name, BranchType::Local).is_ok() {
            Ok(())
        } else {
            Err(AppError::new(
                ErrorKind::RefNotFound,
                format!("branch `{name}` does not exist"),
            ))
        }
    }

    fn commit(&self, oid: &str) -> AppResult<()> {
        let id = git2::Oid::from_str(oid)
            .map_err(|_| invalid(format!("`{oid}` is not a valid commit id")))?;
        self.repo.find_commit(id).map(|_| ()).map_err(|_| {
            AppError::new(
                ErrorKind::RefNotFound,
                format!("commit {oid} does not exist"),
            )
        })
    }

    fn commits(&self, list: &[Oid]) -> AppResult<()> {
        if list.is_empty() || list.len() > 20 {
            return Err(invalid("a step must name between 1 and 20 commits"));
        }
        list.iter().try_for_each(|c| self.commit(c))
    }

    fn remote(&self, name: &str) -> AppResult<()> {
        if name.starts_with('-') || self.repo.find_remote(name).is_err() {
            return Err(AppError::new(
                ErrorKind::RefNotFound,
                format!("remote `{name}` does not exist"),
            ));
        }
        Ok(())
    }

    fn step(&mut self, cmd: &PlannedCommand) -> AppResult<()> {
        match cmd {
            PlannedCommand::Checkout { target } => match target {
                CheckoutTarget::Branch { name } => self.existing_branch(name),
                CheckoutTarget::Commit { oid } => self.commit(oid),
                CheckoutTarget::RemoteBranch { name, local_name } => {
                    self.branch_name(local_name)?;
                    if self.repo.find_branch(name, BranchType::Remote).is_err() {
                        return Err(AppError::new(
                            ErrorKind::RefNotFound,
                            format!("remote branch `{name}` does not exist"),
                        ));
                    }
                    self.created.insert(local_name.clone());
                    Ok(())
                }
            },
            PlannedCommand::BranchCreate { request } => {
                self.branch_name(&request.name)?;
                if let Some(sp) = &request.start_point {
                    self.spec(sp, "start point")?;
                }
                self.created.insert(request.name.clone());
                Ok(())
            }
            PlannedCommand::Merge { request } => {
                self.spec(&request.source, "merge source")?;
                if let Some(into) = &request.into {
                    self.existing_branch(into)?;
                }
                Ok(())
            }
            PlannedCommand::Rebase { request } => {
                self.spec(&request.onto, "rebase target")?;
                if let Some(b) = &request.branch {
                    self.existing_branch(b)?;
                }
                Ok(())
            }
            PlannedCommand::CherryPick { request } => {
                self.commits(&request.commits)?;
                if let Some(b) = &request.target_branch {
                    self.existing_branch(b)?;
                }
                Ok(())
            }
            PlannedCommand::Revert { request } => self.commits(&request.commits),
            PlannedCommand::Reset { request } => self.spec(&request.target, "reset target"),
            PlannedCommand::TagCreate { request } => {
                if request.name.starts_with('-')
                    || !git2::Reference::is_valid_name(&format!("refs/tags/{}", request.name))
                {
                    return Err(invalid(format!(
                        "`{}` is not a valid tag name",
                        request.name
                    )));
                }
                self.spec(&request.target, "tag target")?;
                self.created.insert(request.name.clone());
                Ok(())
            }
            PlannedCommand::StashSave { .. } => Ok(()),
            PlannedCommand::Fetch { request } => {
                net::fetch_args(request)?;
                request.remote.as_deref().map_or(Ok(()), |r| self.remote(r))
            }
            PlannedCommand::Pull { request } => {
                net::pull_args(request)?;
                request.remote.as_deref().map_or(Ok(()), |r| self.remote(r))
            }
            PlannedCommand::Push { request } => {
                net::push_args(request)?;
                self.remote(&request.remote)
            }
        }
    }
}

/// Validates every step's inputs against the repository. Names created by
/// earlier steps count as existing for later ones.
pub fn validate(repo: &Repository, steps: &[PlannedStep]) -> AppResult<()> {
    if steps.len() > MAX_STEPS {
        return Err(invalid(format!("a plan has at most {MAX_STEPS} steps")));
    }
    let mut checker = Checker {
        repo,
        created: HashSet::new(),
    };
    for (i, s) in steps.iter().enumerate() {
        checker.step(&s.command).map_err(|mut e| {
            e.message = format!("Step {}: {}", i + 1, e.message);
            e
        })?;
    }
    Ok(())
}

// ----------------------------------------------------------------- dispatch

fn is_network(cmd: &PlannedCommand) -> bool {
    matches!(
        cmd,
        PlannedCommand::Fetch { .. } | PlannedCommand::Pull { .. } | PlannedCommand::Push { .. }
    )
}

/// Runs a local (non-network) command through its service. `None` for
/// commands that have no local implementation.
fn run_local(
    repo: &Repository,
    cli: &GitCli,
    cmd: &PlannedCommand,
    dry_run: bool,
) -> Option<AppResult<OpOutcome>> {
    Some(match cmd {
        PlannedCommand::Checkout { target } => LibGit.checkout(repo, target, dry_run),
        PlannedCommand::BranchCreate { request } => LibGit.branch_create(repo, request, dry_run),
        PlannedCommand::Merge { request } => LibGit.merge(repo, request, dry_run),
        PlannedCommand::Rebase { request } => LibGit.rebase(repo, request, dry_run),
        PlannedCommand::CherryPick { request } => LibGit.cherry_pick(repo, request, dry_run),
        PlannedCommand::Revert { request } => LibGit.revert(repo, request, dry_run),
        PlannedCommand::Reset { request } => LibGit.reset(repo, request, dry_run),
        PlannedCommand::TagCreate { request } => LibGit.tag_create(repo, request, dry_run),
        // No dry run for stash: previewed as "not previewed".
        PlannedCommand::StashSave { request } if !dry_run => LibGit.stash_save(repo, cli, request),
        PlannedCommand::StashSave { .. } => return None,
        PlannedCommand::Fetch { .. }
        | PlannedCommand::Pull { .. }
        | PlannedCommand::Push { .. } => return None,
    })
}

// ------------------------------------------------------------------ preview

/// Dry-runs each step in order against the *current* state and merges the
/// results into one preview.
pub fn preview(state: &GitState, repo_id: &str, steps: &[PlannedStep]) -> AppResult<OpPreview> {
    let cli = state.cli().clone();
    let mut summaries = Vec::new();
    let mut out = OpPreview {
        summary: String::new(),
        ref_updates: Vec::new(),
        commits_created: 0,
        commits_dropped: Vec::new(),
        predicted_conflicts: Vec::new(),
        warnings: Vec::new(),
    };
    let mut mutating = 0;
    for (i, step) in steps.iter().enumerate() {
        let n = i + 1;
        mutating += 1;
        if let PlannedCommand::Reset { request } = &step.command {
            if request.mode == ResetMode::Hard {
                out.warnings.push(format!(
                    "Step {n} is a hard reset and discards uncommitted changes."
                ));
            }
        }
        if let PlannedCommand::Push { request } = &step.command {
            if request.force_with_lease {
                out.warnings
                    .push(format!("Step {n} force-pushes (with lease)."));
            }
        }
        if is_network(&step.command) {
            out.warnings.push(format!(
                "Step {n} ({}) talks to a remote and cannot be previewed.",
                step.description
            ));
            summaries.push(step.description.clone());
            continue;
        }
        let result =
            state.with_repo(repo_id, |_, r| Ok(run_local(r, &cli, &step.command, true)))?;
        match result {
            Some(Ok(OpOutcome::Preview { preview: p })) => {
                summaries.push(if p.summary.is_empty() {
                    step.description.clone()
                } else {
                    p.summary
                });
                out.ref_updates.extend(p.ref_updates);
                out.commits_created += p.commits_created;
                out.commits_dropped.extend(p.commits_dropped);
                out.predicted_conflicts.extend(
                    p.predicted_conflicts
                        .into_iter()
                        .map(|c| format!("step {n}: {c}")),
                );
                out.warnings
                    .extend(p.warnings.into_iter().map(|w| format!("Step {n}: {w}")));
            }
            Some(Ok(_)) | None => {
                out.warnings
                    .push(format!("Step {n} ({}) has no preview.", step.description));
                summaries.push(step.description.clone());
            }
            Some(Err(e)) => {
                out.warnings.push(format!(
                    "Step {n} ({}) could not be previewed against the current state: {}",
                    step.description, e.message
                ));
                summaries.push(step.description.clone());
            }
        }
    }
    if steps.len() > 1 {
        out.warnings.insert(
            0,
            "Steps are previewed one by one against the current repository state; later steps may behave differently once earlier steps have run.".to_string(),
        );
    }
    if mutating > 1 {
        out.warnings.push(format!(
            "This plan changes the repository in {mutating} steps. Each step is recorded separately in the operation log and undone one at a time."
        ));
    }
    out.summary = if steps.is_empty() {
        "No changes".to_string()
    } else {
        format!(
            "{} step{}: {}",
            steps.len(),
            if steps.len() == 1 { "" } else { "s" },
            summaries.join("; ")
        )
    };
    Ok(out)
}

// -------------------------------------------------------------------- store

struct Stored {
    id: String,
    repo: String,
    steps: Vec<PlannedStep>,
}

fn store() -> &'static Mutex<VecDeque<Stored>> {
    static STORE: OnceLock<Mutex<VecDeque<Stored>>> = OnceLock::new();
    STORE.get_or_init(Mutex::default)
}

fn random_id() -> String {
    let a = std::collections::hash_map::RandomState::new()
        .build_hasher()
        .finish();
    let b = std::collections::hash_map::RandomState::new()
        .build_hasher()
        .finish();
    format!("plan-{a:016x}{b:016x}")
}

/// Keeps a validated plan in memory until it is executed.
pub fn remember(repo: &str, steps: Vec<PlannedStep>) -> String {
    let id = random_id();
    let mut q = store().lock().unwrap_or_else(|e| e.into_inner());
    while q.len() >= MAX_STORED {
        q.pop_front();
    }
    q.push_back(Stored {
        id: id.clone(),
        repo: repo.to_string(),
        steps,
    });
    id
}

fn take(repo: &str, plan_id: &str) -> AppResult<Vec<PlannedStep>> {
    let mut q = store().lock().unwrap_or_else(|e| e.into_inner());
    let pos = q
        .iter()
        .position(|p| p.id == plan_id)
        .ok_or_else(|| invalid("unknown or already executed plan"))?;
    if q[pos].repo != repo {
        return Err(invalid("this plan belongs to another repository"));
    }
    Ok(q.remove(pos).map(|p| p.steps).unwrap_or_default())
}

// ---------------------------------------------------------------- execution

fn synth_applied(repo: &Repository, message: &str) -> AppResult<OpOutcome> {
    Ok(OpOutcome::Applied {
        // Fetch and push are not journaled, so there is nothing to undo.
        oplog_id: String::new(),
        head: head_state(repo)?,
        message: message.to_string(),
    })
}

fn run_network(
    state: &GitState,
    repo_id: &str,
    session: &NetSession,
    cmd: &PlannedCommand,
) -> AppResult<OpOutcome> {
    let entry = state.entry(repo_id)?;
    let repo = Repository::open(&entry.git_dir)?;
    let result = match cmd {
        PlannedCommand::Fetch { request } => {
            net::fetch(session, &net::run_dir(&repo), request)?;
            synth_applied(&repo, "Fetched")
        }
        PlannedCommand::Pull { request } => net::pull(session, &repo, request),
        PlannedCommand::Push { request } => {
            net::push(session, &net::run_dir(&repo), request)?;
            synth_applied(&repo, "Pushed")
        }
        _ => Err(invalid("not a network step")),
    };
    entry.invalidate_graph();
    result
}

/// Runs the stored plan step by step. Stops at the first error (returned,
/// with a note about what already ran) or conflict (returned as the outcome).
/// `session` builds the credential-bridged network session lazily, only when
/// the plan contains a fetch/pull/push step.
pub fn execute(
    state: &GitState,
    repo_id: &str,
    plan_id: &str,
    session: &dyn Fn() -> AppResult<NetSession>,
) -> AppResult<OpOutcome> {
    let steps = take(repo_id, plan_id)?;
    let total = steps.len();
    if total == 0 {
        return Err(invalid("the plan has no steps"));
    }
    let cli = state.cli().clone();
    let mut net_session: Option<NetSession> = None;
    let mut last: Option<OpOutcome> = None;
    for (i, step) in steps.iter().enumerate() {
        let fail = |mut e: AppError| {
            e.message = format!("Step {} of {total} failed: {}", i + 1, e.message);
            if i > 0 {
                e.detail = Some(format!(
                    "Steps 1-{i} were applied; each is in the operation log and can be undone."
                ));
            }
            e
        };
        let outcome = if is_network(&step.command) {
            if net_session.is_none() {
                net_session = Some(session().map_err(fail)?);
            }
            let sess = net_session.as_ref().expect("session was just created");
            run_network(state, repo_id, sess, &step.command).map_err(fail)?
        } else {
            let cmd = &step.command;
            state
                .write_repo(repo_id, |r| {
                    run_local(r, &cli, cmd, false)
                        .unwrap_or_else(|| Err(invalid("unsupported step")))
                })
                .map_err(fail)?
        };
        match outcome {
            OpOutcome::Applied { .. } => last = Some(outcome),
            other => return Ok(other),
        }
    }
    Ok(match last {
        Some(OpOutcome::Applied {
            oplog_id,
            head,
            message,
        }) if total > 1 => OpOutcome::Applied {
            oplog_id,
            head,
            message: format!("Ran {total} steps. Last: {message}"),
        },
        Some(o) => o,
        None => return Err(invalid("the plan has no steps")),
    })
}

#[cfg(test)]
mod tests;
