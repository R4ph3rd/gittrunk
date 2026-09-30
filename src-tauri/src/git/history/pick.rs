//! `cherry_pick` and `revert`.

use git2::{Oid, Repository};

use super::sim::{simulate, SimOp, SimStep};
use super::*;

pub(super) fn pick(
    repo: &Repository,
    commits: &[String],
    target_branch: Option<&str>,
    no_commit: bool,
    revert: bool,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    let verb = if revert { "Revert" } else { "Cherry-pick" };
    ensure_idle(repo)?;
    if commits.is_empty() {
        return Err(invalid("no commits given"));
    }
    let mut oids: Vec<Oid> = Vec::new();
    let mut has_merge = false;
    for c in commits {
        let commit = resolve_hex(repo, c)?;
        has_merge |= commit.parent_count() > 1;
        oids.push(commit.id());
    }
    if has_merge && oids.len() > 1 {
        return Err(invalid(
            "merge commits can only be picked or reverted on their own",
        ));
    }

    let current = current_branch(repo);
    let onto = target_branch.map(|b| local_branch(repo, b)).transpose()?;
    let switch = onto.clone().filter(|b| Some(b) != current.as_ref());
    if switch.is_some() {
        ensure_clean_tracked(repo)?;
    }
    let (ref_name, label, base) = match &onto {
        Some(b) => (
            format!("refs/heads/{b}"),
            b.clone(),
            repo.find_branch(b, git2::BranchType::Local)?
                .get()
                .peel_to_commit()?
                .id(),
        ),
        None => (
            head_ref_name(repo),
            current.clone().unwrap_or_else(|| "HEAD".into()),
            head_commit(repo)?.id(),
        ),
    };

    let steps: Vec<SimStep> = oids
        .iter()
        .map(|oid| SimStep {
            oid: *oid,
            op: if revert { SimOp::Revert } else { SimOp::Pick },
        })
        .collect();
    let sim = simulate(repo, base, &steps)?;
    let n = oids.len();
    let summary = format!(
        "{verb} {n} commit(s){} on {label}",
        if no_commit { " without committing" } else { "" }
    );
    if dry_run {
        let mut warnings = Vec::new();
        let mut planned = Vec::new();
        if no_commit {
            warnings.push("the changes are staged, not committed".to_string());
        } else if sim.conflicts.is_empty() {
            planned.push(PlannedUpdate::new(ref_name, Some(base), Some(sim.tip)));
        }
        if !sim.conflicts.is_empty() {
            warnings.push("the operation will stop on conflicts".to_string());
        }
        if let Some(b) = &switch {
            warnings.insert(0, format!("{b} will be checked out first"));
        }
        let created = if no_commit { 0 } else { sim.created };
        return preview_outcome(repo, summary, &planned, created, warnings, sim.conflicts);
    }

    let mut cmd = args(&[if revert { "revert" } else { "cherry-pick" }]);
    if revert {
        cmd.push("--no-edit".into());
    }
    if no_commit {
        cmd.push("-n".into());
    }
    if has_merge {
        cmd.push("-m".into());
        cmd.push("1".into());
    }
    // Validated hex ids: they can never be read as options.
    cmd.extend(oids.iter().map(|o| o.to_string()));
    let operation = if revert { "revert" } else { "cherry_pick" };
    let (stop, entry) = record(repo, operation, summary, |repo| {
        if let Some(b) = &switch {
            switch_branch(repo, b)?;
        }
        let out = run_git(repo, &cmd, &[])?;
        interpret(repo, out)
    })?;
    let done = format!(
        "{}{} {n} commit(s) on {label}",
        verb,
        if revert { "ed" } else { "-picked" },
    );
    let done = if no_commit {
        format!("{done}; changes are staged")
    } else {
        done
    };
    outcome(repo, stop, entry, done)
}
