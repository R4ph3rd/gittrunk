//! Helpers that turn a planned set of ref updates into an `OpPreview`.

use std::collections::HashSet;

use git2::{Oid, Repository, Sort};

use crate::ipc::error::AppResult;
use crate::ipc::types::{CommitSummary, OpPreview, RefUpdate};

/// Most dropped commits listed in a preview.
pub const DROPPED_CAP: usize = 50;

/// One ref about to change. `name` is a full ref name, or `HEAD` when HEAD is
/// detached. `None` means "does not exist" (before creation / after deletion).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedUpdate {
    pub name: String,
    pub from: Option<Oid>,
    pub to: Option<Oid>,
}

impl PlannedUpdate {
    pub fn new(name: impl Into<String>, from: Option<Oid>, to: Option<Oid>) -> Self {
        Self {
            name: name.into(),
            from,
            to,
        }
    }
}

pub fn ref_updates(planned: &[PlannedUpdate]) -> Vec<RefUpdate> {
    planned
        .iter()
        .map(|p| RefUpdate {
            name: p.name.clone(),
            from: p.from.map(|o| o.to_string()),
            to: p.to.map(|o| o.to_string()),
        })
        .collect()
}

pub fn commit_summary(commit: &git2::Commit<'_>) -> CommitSummary {
    let hex = commit.id().to_string();
    CommitSummary {
        short_oid: hex[..7.min(hex.len())].to_string(),
        oid: hex,
        summary: commit
            .summary()
            .ok()
            .flatten()
            .unwrap_or_default()
            .to_string(),
        author_name: commit.author().name().unwrap_or_default().to_string(),
        author_time: commit.author().when().seconds() as f64,
    }
}

fn is_history_ref(name: &str) -> bool {
    name.starts_with("refs/heads/")
        || name.starts_with("refs/tags/")
        || name.starts_with("refs/remotes/")
        || name == "refs/stash"
}

fn peel_commit(repo: &Repository, oid: Oid) -> Option<Oid> {
    repo.find_object(oid, None)
        .ok()?
        .peel_to_commit()
        .ok()
        .map(|c| c.id())
}

/// Commits reachable from the old tips of `planned` that no ref reaches once
/// the updates are applied (capped at `DROPPED_CAP`, newest first).
pub fn commits_dropped(
    repo: &Repository,
    planned: &[PlannedUpdate],
) -> AppResult<Vec<CommitSummary>> {
    let changing: HashSet<&str> = planned.iter().map(|p| p.name.as_str()).collect();
    let mut keep: Vec<Oid> = planned
        .iter()
        .filter_map(|p| p.to)
        .filter_map(|o| peel_commit(repo, o))
        .collect();
    for r in repo.references()?.flatten() {
        let Ok(name) = r.name() else { continue };
        if !is_history_ref(name) || changing.contains(name) {
            continue;
        }
        if let Some(oid) = r.resolve().ok().and_then(|r| r.target()) {
            keep.extend(peel_commit(repo, oid));
        }
    }
    if !changing.contains("HEAD") && repo.head_detached().unwrap_or(false) {
        if let Some(oid) = repo.head().ok().and_then(|h| h.target()) {
            keep.extend(peel_commit(repo, oid));
        }
    }

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME)?;
    let mut any = false;
    for oid in planned
        .iter()
        .filter_map(|p| p.from)
        .filter_map(|o| peel_commit(repo, o))
    {
        walk.push(oid)?;
        any = true;
    }
    if !any {
        return Ok(Vec::new());
    }
    for oid in keep {
        walk.hide(oid)?;
    }
    let mut out = Vec::new();
    for oid in walk {
        if out.len() >= DROPPED_CAP {
            break;
        }
        out.push(commit_summary(&repo.find_commit(oid?)?));
    }
    Ok(out)
}

/// Paths that would conflict when merging `theirs` into `ours` (in memory,
/// nothing is written to the working tree or the index).
pub fn predicted_conflicts(repo: &Repository, ours: Oid, theirs: Oid) -> AppResult<Vec<String>> {
    let ours = repo.find_commit(ours)?;
    let theirs = repo.find_commit(theirs)?;
    let index = repo.merge_commits(&ours, &theirs, None)?;
    let mut paths = Vec::new();
    for conflict in index.conflicts()?.flatten() {
        let entry = conflict.our.or(conflict.their).or(conflict.ancestor);
        if let Some(e) = entry {
            paths.push(String::from_utf8_lossy(&e.path).into_owned());
        }
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

/// Assembles the preview of a planned operation.
pub fn build(
    repo: &Repository,
    summary: impl Into<String>,
    planned: &[PlannedUpdate],
    commits_created: u32,
    warnings: Vec<String>,
    predicted_conflicts: Vec<String>,
) -> AppResult<OpPreview> {
    Ok(OpPreview {
        summary: summary.into(),
        ref_updates: ref_updates(planned),
        commits_created,
        commits_dropped: commits_dropped(repo, planned)?,
        predicted_conflicts,
        warnings,
    })
}

#[cfg(test)]
mod tests;
