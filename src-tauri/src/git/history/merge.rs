//! `merge`.

use git2::{Oid, Repository, Signature};

use super::*;

/// What git is given for the merge source: the short name when the user
/// named a branch or tag (so the merge message reads `Merge branch 'x'`),
/// otherwise the resolved commit id. Both are safe as arguments: a leading
/// `-` was refused by `resolve_commit` and ref names cannot start with one.
fn source_arg(repo: &Repository, spec: &str, commit: Oid) -> String {
    let spec = spec.trim();
    repo.resolve_reference_from_short_name(spec)
        .ok()
        .filter(|r| r.name().is_ok_and(|n| n.starts_with("refs/")))
        .and_then(|r| {
            let full = r.name().ok()?.to_string();
            let short = r.shorthand().ok()?.to_string();
            Some(if spec == full { full } else { short })
        })
        .filter(|n| !n.starts_with('-'))
        .unwrap_or_else(|| commit.to_string())
}

/// The merge commit that would be created, when the merge is clean. It is
/// written as an unreferenced object.
fn predicted_merge_commit(repo: &Repository, ours: Oid, theirs: Oid) -> AppResult<Oid> {
    let o = repo.find_commit(ours)?;
    let t = repo.find_commit(theirs)?;
    let mut index = repo.merge_commits(&o, &t, None)?;
    let tree = repo.find_tree(index.write_tree_to(repo)?)?;
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("gittrunk", "gittrunk@localhost"))?;
    Ok(repo.commit(None, &sig, &sig, "Merge (preview)", &tree, &[&o, &t])?)
}

pub(super) fn merge(
    repo: &Repository,
    request: &MergeRequest,
    dry_run: bool,
) -> AppResult<OpOutcome> {
    ensure_idle(repo)?;
    let source = resolve_commit(repo, &request.source)?;
    let src = source.id();
    let arg = source_arg(repo, &request.source, src);

    let current = current_branch(repo);
    let into = request
        .into
        .as_deref()
        .map(|n| local_branch(repo, n))
        .transpose()?;
    let switch = into.clone().filter(|n| Some(n) != current.as_ref());
    if switch.is_some() {
        ensure_clean_tracked(repo)?;
    }
    let target = into.clone().or(current);
    let base = match &into {
        Some(n) => repo
            .find_branch(n, git2::BranchType::Local)?
            .get()
            .peel_to_commit()?
            .id(),
        None => head_commit(repo)?.id(),
    };
    let ref_name = match &target {
        Some(n) => format!("refs/heads/{n}"),
        None => "HEAD".to_string(),
    };
    let target_label = target.clone().unwrap_or_else(|| "HEAD".into());

    let up_to_date = src == base || repo.graph_descendant_of(base, src)?;
    let ff = !up_to_date && repo.graph_descendant_of(src, base)?;
    if ff || up_to_date {
        // nothing diverged
    } else if request.strategy == MergeStrategy::FfOnly {
        return Err(invalid(format!(
            "cannot fast-forward {target_label}: the branches have diverged"
        )));
    }
    let brought = if up_to_date {
        0
    } else {
        range_oldest_first(repo, src, base)?.len()
    };
    let source_name = request.source.trim();

    // Plan: summary, ref updates, conflicts, message.
    let mut planned = Vec::new();
    let mut warnings = Vec::new();
    let mut conflicts = Vec::new();
    let mut created = 0;
    let summary;
    let done;
    if up_to_date {
        summary = format!("Merge {source_name} into {target_label}: already up to date");
        done = "Already up to date".to_string();
    } else if request.strategy == MergeStrategy::Squash {
        conflicts = preview::predicted_conflicts(repo, base, src)?;
        summary =
            format!("Squash {brought} commit(s) of {source_name} into the index of {target_label}");
        warnings.push("the result is left staged; commit it to finish".to_string());
        done = format!("Squash merge of {source_name} is staged; commit it to finish");
    } else if ff && request.strategy != MergeStrategy::NoFf {
        planned.push(PlannedUpdate::new(ref_name, Some(base), Some(src)));
        summary = format!("Fast-forward {target_label} to {source_name} ({brought} commit(s))");
        done = format!("Fast-forwarded {target_label} to {}", short(src));
    } else {
        conflicts = preview::predicted_conflicts(repo, base, src)?;
        created = 1;
        if conflicts.is_empty() {
            let merged = predicted_merge_commit(repo, base, src)?;
            planned.push(PlannedUpdate::new(ref_name, Some(base), Some(merged)));
        } else {
            warnings.push("the merge will stop on conflicts".to_string());
        }
        summary = format!("Merge {source_name} into {target_label} ({brought} commit(s))");
        done = format!("Merged {source_name} into {target_label}");
    }
    if let Some(n) = &switch {
        warnings.insert(0, format!("{n} will be checked out first"));
    }
    if dry_run {
        return preview_outcome(repo, summary, &planned, created, warnings, conflicts);
    }

    let mut cmd = args(&["merge", "--no-edit"]);
    match request.strategy {
        MergeStrategy::Auto => {}
        MergeStrategy::NoFf => cmd.push("--no-ff".into()),
        MergeStrategy::FfOnly => cmd.push("--ff-only".into()),
        MergeStrategy::Squash => cmd.push("--squash".into()),
    }
    if let Some(m) = request.message.as_deref().filter(|m| !m.trim().is_empty()) {
        cmd.push("-m".into());
        cmd.push(m.to_string());
    }
    cmd.push("--".into());
    cmd.push(arg);
    let (stop, entry) = record(repo, "merge", summary, |repo| {
        if let Some(n) = &switch {
            switch_branch(repo, n)?;
        }
        let out = run_git(repo, &cmd, &[])?;
        interpret(repo, out)
    })?;
    outcome(repo, stop, entry, done)
}
