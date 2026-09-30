//! Ref-level write operations (branches, tags, checkout, ref move, reset).
//! Kept in its own trait so it does not touch `GitService`.

use std::collections::BTreeSet;

use git2::build::CheckoutBuilder;
use git2::{BranchType, Commit, Oid, Repository, ResetType};

use crate::git::libgit::repo::head_state;
use crate::git::libgit::LibGit;
use crate::git::oplog::restore;
use crate::git::oplog::Oplog;
use crate::git::preview::{self, PlannedUpdate};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub trait RefWriteService: Send + Sync {
    fn branch_create(
        &self,
        repo: &Repository,
        request: &BranchCreateRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    fn branch_delete(
        &self,
        repo: &Repository,
        request: &BranchDeleteRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    fn branch_rename(
        &self,
        repo: &Repository,
        old_name: &str,
        new_name: &str,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    fn checkout(
        &self,
        repo: &Repository,
        target: &CheckoutTarget,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    fn tag_create(
        &self,
        repo: &Repository,
        request: &TagCreateRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    fn tag_delete(&self, repo: &Repository, name: &str, dry_run: bool) -> AppResult<OpOutcome>;
    fn ref_move(
        &self,
        repo: &Repository,
        request: &RefMoveRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
    fn reset(
        &self,
        repo: &Repository,
        request: &ResetRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome>;
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

fn resolve_commit<'r>(repo: &'r Repository, spec: &str) -> AppResult<Commit<'r>> {
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

fn head_commit_id(repo: &Repository) -> Option<Oid> {
    repo.head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id())
}

fn short(oid: Oid) -> String {
    oid.to_string()[..7].to_string()
}

fn applied(repo: &Repository, entry: OplogEntry, message: String) -> AppResult<OpOutcome> {
    Ok(OpOutcome::Applied {
        oplog_id: entry.id,
        head: head_state(repo)?,
        message,
    })
}

fn preview_outcome(
    repo: &Repository,
    summary: String,
    planned: &[PlannedUpdate],
    warnings: Vec<String>,
) -> AppResult<OpOutcome> {
    Ok(OpOutcome::Preview {
        preview: preview::build(repo, summary, planned, 0, warnings, Vec::new())?,
    })
}

fn check_branch_name(name: &str) -> AppResult<()> {
    if git2::Branch::name_is_valid(name).unwrap_or(false) {
        Ok(())
    } else {
        Err(invalid(format!("`{name}` is not a valid branch name")))
    }
}

/// Paths a checkout of `target` would overwrite: changed between HEAD and
/// `target` while the index or working tree holds something else.
fn checkout_conflicts(repo: &Repository, target: &Commit<'_>) -> AppResult<Vec<String>> {
    let Some(workdir) = repo.workdir() else {
        return Ok(Vec::new());
    };
    let head_tree = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_tree().ok())
        .map(|t| t.id());
    let changes = restore::tree_changes(repo, head_tree, Some(target.tree_id()))?;
    let mut index = repo.index()?;
    index.read(true)?;
    let mut paths = BTreeSet::new();
    for c in changes {
        let wt = restore::worktree_blob_id(repo, workdir, &c.path);
        let wt_ok = wt == c.from.map(|f| f.0) || wt == c.to.map(|t| t.0);
        let staged = index
            .get_path(std::path::Path::new(&c.path), 0)
            .map(|e| e.id);
        let idx_ok = staged == c.from.map(|f| f.0) || staged == c.to.map(|t| t.0);
        if !(wt_ok && idx_ok) {
            paths.insert(c.path);
        }
    }
    Ok(paths.into_iter().collect())
}

fn ensure_checkout_safe(repo: &Repository, target: &Commit<'_>) -> AppResult<()> {
    let paths = checkout_conflicts(repo, target)?;
    if paths.is_empty() {
        return Ok(());
    }
    Err(AppError::new(
        ErrorKind::DirtyWorktree,
        format!(
            "local changes would be overwritten by checkout: {}",
            paths.join(", ")
        ),
    )
    .with_detail(paths.join("\n")))
}

/// Safe checkout of `commit`'s tree; the caller moves HEAD afterwards.
fn checkout_tree_safe(repo: &Repository, commit: &Commit<'_>) -> AppResult<()> {
    let mut cb = CheckoutBuilder::new();
    cb.safe();
    repo.checkout_tree(commit.as_object(), Some(&mut cb))
        .map_err(|e| {
            if e.code() == git2::ErrorCode::Conflict {
                AppError::new(
                    ErrorKind::DirtyWorktree,
                    "local changes would be overwritten by checkout",
                )
                .with_detail(e.message().to_string())
            } else {
                e.into()
            }
        })
}

/// `HEAD` entry describing where the checked-out commit changes.
fn head_update(repo: &Repository, to: Oid) -> Vec<PlannedUpdate> {
    vec![PlannedUpdate::new("HEAD", head_commit_id(repo), Some(to))]
}

/// True when `tip` is reachable from HEAD or from `upstream`.
fn is_merged(repo: &Repository, tip: Oid, upstream: Option<Oid>) -> bool {
    let reaches = |from: Oid| from == tip || repo.graph_descendant_of(from, tip).unwrap_or(false);
    head_commit_id(repo).is_some_and(reaches) || upstream.is_some_and(reaches)
}

fn full_ref_name(repo: &Repository, name: &str) -> AppResult<String> {
    if name.starts_with("refs/") {
        return Ok(name.to_string());
    }
    for prefix in ["refs/heads/", "refs/tags/"] {
        let full = format!("{prefix}{name}");
        if repo.find_reference(&full).is_ok() {
            return Ok(full);
        }
    }
    Err(AppError::new(
        ErrorKind::RefNotFound,
        format!("no branch or tag named `{name}`"),
    ))
}

impl RefWriteService for LibGit {
    fn branch_create(
        &self,
        repo: &Repository,
        request: &BranchCreateRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        check_branch_name(&request.name)?;
        if repo.find_branch(&request.name, BranchType::Local).is_ok() {
            return Err(invalid(format!("branch `{}` already exists", request.name)));
        }
        let start = resolve_commit(repo, request.start_point.as_deref().unwrap_or("HEAD"))?;
        if request.checkout {
            ensure_checkout_safe(repo, &start)?;
        }
        let full = format!("refs/heads/{}", request.name);
        let mut planned = vec![PlannedUpdate::new(full, None, Some(start.id()))];
        if request.checkout {
            planned.extend(head_update(repo, start.id()));
        }
        let summary = format!("Create branch {} at {}", request.name, short(start.id()));
        if dry_run {
            return preview_outcome(repo, summary, &planned, Vec::new());
        }
        let name = request.name.clone();
        let checkout = request.checkout;
        let ((), entry) = Oplog::record(repo, "branch_create", summary.clone(), false, |repo| {
            let commit = repo.find_commit(start.id())?;
            repo.branch(&name, &commit, false)?;
            if checkout {
                checkout_tree_safe(repo, &commit)?;
                repo.set_head(&format!("refs/heads/{name}"))?;
            }
            Ok(())
        })?;
        applied(repo, entry, summary)
    }

    fn branch_delete(
        &self,
        repo: &Repository,
        request: &BranchDeleteRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        if request.remote {
            return Err(AppError::not_implemented("branch_delete (remote)"));
        }
        let branch = repo
            .find_branch(&request.name, BranchType::Local)
            .map_err(|_| {
                AppError::new(
                    ErrorKind::RefNotFound,
                    format!("no local branch `{}`", request.name),
                )
            })?;
        if branch.is_head() {
            return Err(invalid(format!(
                "cannot delete `{}`: it is the checked-out branch",
                request.name
            )));
        }
        let tip = branch.get().peel_to_commit()?.id();
        let upstream = branch
            .upstream()
            .ok()
            .and_then(|u| u.get().peel_to_commit().ok())
            .map(|c| c.id());
        let merged = is_merged(repo, tip, upstream);
        if !merged && !request.force {
            return Err(invalid(format!(
                "branch `{}` is not fully merged into HEAD or its upstream; use force to delete it anyway",
                request.name
            )));
        }
        let mut warnings = Vec::new();
        if !merged {
            warnings.push("branch not fully merged".to_string());
        }
        let planned = vec![PlannedUpdate::new(
            format!("refs/heads/{}", request.name),
            Some(tip),
            None,
        )];
        let summary = format!("Delete branch {} (was {})", request.name, short(tip));
        if dry_run {
            return preview_outcome(repo, summary, &planned, warnings);
        }
        drop(branch);
        let name = request.name.clone();
        let ((), entry) = Oplog::record(repo, "branch_delete", summary.clone(), false, |repo| {
            repo.find_branch(&name, BranchType::Local)?.delete()?;
            Ok(())
        })?;
        applied(repo, entry, summary)
    }

    fn branch_rename(
        &self,
        repo: &Repository,
        old_name: &str,
        new_name: &str,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        check_branch_name(new_name)?;
        let branch = repo.find_branch(old_name, BranchType::Local).map_err(|_| {
            AppError::new(
                ErrorKind::RefNotFound,
                format!("no local branch `{old_name}`"),
            )
        })?;
        if repo.find_branch(new_name, BranchType::Local).is_ok() {
            return Err(invalid(format!("branch `{new_name}` already exists")));
        }
        let tip = branch.get().peel_to_commit()?.id();
        let planned = vec![
            PlannedUpdate::new(format!("refs/heads/{old_name}"), Some(tip), None),
            PlannedUpdate::new(format!("refs/heads/{new_name}"), None, Some(tip)),
        ];
        let summary = format!("Rename branch {old_name} to {new_name}");
        if dry_run {
            return preview_outcome(repo, summary, &planned, Vec::new());
        }
        drop(branch);
        let (old, new) = (old_name.to_string(), new_name.to_string());
        let ((), entry) = Oplog::record(repo, "branch_rename", summary.clone(), false, |repo| {
            repo.find_branch(&old, BranchType::Local)?
                .rename(&new, false)?;
            Ok(())
        })?;
        applied(repo, entry, summary)
    }

    fn checkout(
        &self,
        repo: &Repository,
        target: &CheckoutTarget,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        let mut warnings = Vec::new();
        let mut planned = Vec::new();
        // (commit, branch to attach to, branch to create first)
        let (commit, attach, create): (Commit, Option<String>, Option<(String, String)>) =
            match target {
                CheckoutTarget::Branch { name } => {
                    let branch = repo.find_branch(name, BranchType::Local).map_err(|_| {
                        AppError::new(ErrorKind::RefNotFound, format!("no local branch `{name}`"))
                    })?;
                    (
                        branch.get().peel_to_commit()?,
                        Some(format!("refs/heads/{name}")),
                        None,
                    )
                }
                CheckoutTarget::Commit { oid } => {
                    warnings.push("detached HEAD".to_string());
                    (resolve_commit(repo, oid)?, None, None)
                }
                CheckoutTarget::RemoteBranch { name, local_name } => {
                    check_branch_name(local_name)?;
                    if repo.find_branch(local_name, BranchType::Local).is_ok() {
                        return Err(invalid(format!("branch `{local_name}` already exists")));
                    }
                    let remote = repo.find_branch(name, BranchType::Remote).map_err(|_| {
                        AppError::new(ErrorKind::RefNotFound, format!("no remote branch `{name}`"))
                    })?;
                    let commit = remote.get().peel_to_commit()?;
                    planned.push(PlannedUpdate::new(
                        format!("refs/heads/{local_name}"),
                        None,
                        Some(commit.id()),
                    ));
                    (
                        commit,
                        Some(format!("refs/heads/{local_name}")),
                        Some((local_name.clone(), name.clone())),
                    )
                }
            };
        ensure_checkout_safe(repo, &commit)?;
        planned.extend(head_update(repo, commit.id()));
        let summary = match (&attach, target) {
            (Some(r), _) => format!("Check out {}", r.trim_start_matches("refs/heads/")),
            (None, _) => format!("Check out {} (detached)", short(commit.id())),
        };
        if dry_run {
            return preview_outcome(repo, summary, &planned, warnings);
        }
        let id = commit.id();
        let ((), entry) = Oplog::record(repo, "checkout", summary.clone(), false, |repo| {
            let commit = repo.find_commit(id)?;
            if let Some((local, remote)) = &create {
                let mut b = repo.branch(local, &commit, false)?;
                b.set_upstream(Some(remote))?;
            }
            checkout_tree_safe(repo, &commit)?;
            match &attach {
                Some(r) => repo.set_head(r)?,
                None => repo.set_head_detached(id)?,
            }
            Ok(())
        })?;
        applied(repo, entry, summary)
    }

    fn tag_create(
        &self,
        repo: &Repository,
        request: &TagCreateRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        let full = format!("refs/tags/{}", request.name);
        if !git2::Reference::is_valid_name(&full) || request.name.is_empty() {
            return Err(invalid(format!(
                "`{}` is not a valid tag name",
                request.name
            )));
        }
        if repo.find_reference(&full).is_ok() {
            return Err(invalid(format!("tag `{}` already exists", request.name)));
        }
        let target = repo.revparse_single(&request.target).map_err(|_| {
            AppError::new(
                ErrorKind::RefNotFound,
                format!("cannot resolve `{}`", request.target),
            )
        })?;
        if request.message.is_some() {
            repo.signature().map_err(|_| {
                invalid("cannot create an annotated tag: configure user.name and user.email")
            })?;
        }
        let planned = vec![PlannedUpdate::new(full, None, Some(target.id()))];
        let summary = format!("Create tag {} at {}", request.name, short(target.id()));
        if dry_run {
            return preview_outcome(repo, summary, &planned, Vec::new());
        }
        let target_id = target.id();
        let ((), entry) = Oplog::record(repo, "tag_create", summary.clone(), false, |repo| {
            let obj = repo.find_object(target_id, None)?;
            match &request.message {
                Some(msg) => {
                    let sig = repo.signature()?;
                    repo.tag(&request.name, &obj, &sig, msg, false)?;
                }
                None => {
                    repo.tag_lightweight(&request.name, &obj, false)?;
                }
            }
            Ok(())
        })?;
        applied(repo, entry, summary)
    }

    fn tag_delete(&self, repo: &Repository, name: &str, dry_run: bool) -> AppResult<OpOutcome> {
        let name = name.strip_prefix("refs/tags/").unwrap_or(name);
        let full = format!("refs/tags/{name}");
        let reference = repo
            .find_reference(&full)
            .map_err(|_| AppError::new(ErrorKind::RefNotFound, format!("no tag named `{name}`")))?;
        let target = reference.target();
        let planned = vec![PlannedUpdate::new(full, target, None)];
        let summary = format!("Delete tag {name}");
        if dry_run {
            return preview_outcome(repo, summary, &planned, Vec::new());
        }
        let ((), entry) = Oplog::record(repo, "tag_delete", summary.clone(), false, |repo| {
            repo.tag_delete(name)?;
            Ok(())
        })?;
        applied(repo, entry, summary)
    }

    fn ref_move(
        &self,
        repo: &Repository,
        request: &RefMoveRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        let full = full_ref_name(repo, &request.name)?;
        let is_branch = full.starts_with("refs/heads/");
        if !is_branch && !full.starts_with("refs/tags/") {
            return Err(invalid("only branches and tags can be moved"));
        }
        let current = repo.find_reference(&full)?;
        let from = current.target();
        let target = resolve_commit(repo, &request.target)?;
        let to = target.id();
        let checked_out = is_branch
            && repo
                .head()
                .ok()
                .filter(|h| h.is_branch())
                .and_then(|h| h.name().ok().map(str::to_string))
                .as_deref()
                == Some(full.as_str());
        let planned = vec![PlannedUpdate::new(full.clone(), from, Some(to))];
        let dropped = preview::commits_dropped(repo, &planned)?;
        let mut warnings = Vec::new();
        if checked_out {
            if !request.force {
                return Err(invalid(format!(
                    "`{}` is checked out: moving it needs force and behaves like `reset --soft` (index and working tree stay as they are)",
                    request.name
                )));
            }
            warnings.push(
                "the checked-out branch moves like `reset --soft`: index and working tree are unchanged"
                    .to_string(),
            );
        }
        if !dropped.is_empty() {
            if !request.force {
                return Err(invalid(format!(
                    "moving `{}` would leave {} commit(s) unreachable; use force",
                    request.name,
                    dropped.len()
                )));
            }
            warnings.push(format!("{} commit(s) become unreachable", dropped.len()));
        }
        let summary = format!("Move {} to {}", request.name, short(to));
        if dry_run {
            return preview_outcome(repo, summary, &planned, warnings);
        }
        let ((), entry) = Oplog::record(repo, "ref_move", summary.clone(), false, |repo| {
            repo.reference(&full, to, true, "gittrunk: move ref")?;
            Ok(())
        })?;
        applied(repo, entry, summary)
    }

    fn reset(
        &self,
        repo: &Repository,
        request: &ResetRequest,
        dry_run: bool,
    ) -> AppResult<OpOutcome> {
        let from = head_commit_id(repo).ok_or_else(|| invalid("HEAD has no commits to reset"))?;
        let target = resolve_commit(repo, &request.target)?;
        let to = target.id();
        let head = repo.find_reference("HEAD")?;
        let name = match head.symbolic_target().ok().flatten() {
            Some(n) => n.to_string(),
            None => "HEAD".to_string(),
        };
        let planned = vec![PlannedUpdate::new(name, Some(from), Some(to))];
        let mut warnings = Vec::new();
        let hard = matches!(request.mode, ResetMode::Hard);
        if hard && !repo.is_bare() {
            let mut opts = git2::StatusOptions::new();
            opts.include_untracked(false);
            if !repo.statuses(Some(&mut opts))?.is_empty() {
                warnings.push(
                    "uncommitted changes to tracked files will be discarded (undo restores them)"
                        .to_string(),
                );
            }
        }
        let mode = match request.mode {
            ResetMode::Soft => "soft",
            ResetMode::Mixed => "mixed",
            ResetMode::Hard => "hard",
        };
        let summary = format!("Reset ({mode}) to {}", short(to));
        if dry_run {
            return preview_outcome(repo, summary, &planned, warnings);
        }
        let kind = match request.mode {
            ResetMode::Soft => ResetType::Soft,
            ResetMode::Mixed => ResetType::Mixed,
            ResetMode::Hard => ResetType::Hard,
        };
        let ((), entry) = Oplog::record(repo, "reset", summary.clone(), hard, |repo| {
            let obj = repo.find_object(to, None)?;
            repo.reset(&obj, kind, None)?;
            Ok(())
        })?;
        applied(repo, entry, summary)
    }
}

#[cfg(test)]
mod tests;
