//! Branches, tags, stashes and the ref labels shown in the graph.

use std::collections::HashMap;

use git2::{BranchType, ObjectType, Oid, Repository};

use super::repo::head_state;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

fn kind_order(k: RefKind) -> u8 {
    match k {
        RefKind::LocalBranch => 0,
        RefKind::RemoteBranch => 1,
        RefKind::Tag => 2,
        RefKind::Stash => 3,
    }
}

/// Labels (branches, remote branches, tags) keyed by the commit they point at.
pub fn ref_labels(repo: &Repository) -> AppResult<HashMap<Oid, Vec<RefLabel>>> {
    let head_name = repo
        .head()
        .ok()
        .filter(|_| !repo.head_detached().unwrap_or(false))
        .and_then(|h| h.name().ok().map(str::to_string));

    let mut map: HashMap<Oid, Vec<RefLabel>> = HashMap::new();
    for r in repo.references()? {
        let r = r?;
        let Ok(full) = r.name().map(str::to_string) else {
            continue;
        };
        let (kind, short) = if let Some(s) = full.strip_prefix("refs/heads/") {
            (RefKind::LocalBranch, s)
        } else if let Some(s) = full.strip_prefix("refs/remotes/") {
            if r.symbolic_target_bytes().is_some() {
                continue;
            }
            (RefKind::RemoteBranch, s)
        } else if let Some(s) = full.strip_prefix("refs/tags/") {
            (RefKind::Tag, s)
        } else {
            continue;
        };
        let Ok(obj) = r.peel(ObjectType::Commit) else {
            continue;
        };
        let is_head = head_name.as_deref() == Some(full.as_str());
        map.entry(obj.id()).or_default().push(RefLabel {
            name: short.to_string(),
            full_name: full.clone(),
            kind,
            is_head,
        });
    }
    for labels in map.values_mut() {
        labels.sort_by(|a, b| {
            kind_order(a.kind)
                .cmp(&kind_order(b.kind))
                .then_with(|| a.name.cmp(&b.name))
        });
    }
    Ok(map)
}

fn branch_infos(repo: &Repository, ty: BranchType) -> AppResult<Vec<BranchInfo>> {
    let mut out = Vec::new();
    for b in repo.branches(Some(ty))? {
        let (branch, _) = b?;
        let reference = branch.get();
        if reference.symbolic_target_bytes().is_some() {
            continue;
        }
        let (Some(name), Ok(full)) = (branch.name()?.map(str::to_string), reference.name()) else {
            continue;
        };
        let Ok(commit) = reference.peel_to_commit() else {
            continue;
        };
        let oid = commit.id();
        let (mut upstream, mut ahead, mut behind, mut remote) = (None, 0, 0, None);
        match ty {
            BranchType::Local => {
                if let Ok(up) = branch.upstream() {
                    upstream = up.name()?.map(str::to_string);
                    if let Ok(up_commit) = up.get().peel_to_commit() {
                        if let Ok((a, b)) = repo.graph_ahead_behind(oid, up_commit.id()) {
                            ahead = a as u32;
                            behind = b as u32;
                        }
                    }
                }
            }
            BranchType::Remote => {
                remote = repo
                    .branch_remote_name(full)
                    .ok()
                    .and_then(|b| b.as_str().ok().map(str::to_string));
            }
        }
        out.push(BranchInfo {
            name,
            full_name: full.to_string(),
            oid: oid.to_string(),
            upstream,
            ahead,
            behind,
            is_head: branch.is_head(),
            remote,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn tag_infos(repo: &Repository) -> AppResult<Vec<TagInfo>> {
    let mut raw: Vec<(Oid, String)> = Vec::new();
    repo.tag_foreach(|oid, name| {
        let name = String::from_utf8_lossy(name);
        raw.push((
            oid,
            name.strip_prefix("refs/tags/").unwrap_or(&name).to_string(),
        ));
        true
    })?;
    let mut out = Vec::new();
    for (oid, name) in raw {
        let Ok(obj) = repo.find_object(oid, None) else {
            continue;
        };
        let annotated = obj.kind() == Some(ObjectType::Tag);
        let message = obj
            .as_tag()
            .and_then(|t| t.message().ok().flatten())
            .map(|m| m.trim_end().to_string());
        let Ok(commit) = obj.peel(ObjectType::Commit) else {
            continue;
        };
        out.push(TagInfo {
            name,
            oid: commit.id().to_string(),
            annotated,
            message,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub fn stash_list(repo: &mut Repository) -> AppResult<Vec<StashEntry>> {
    let mut raw: Vec<(usize, String, Oid)> = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        raw.push((index, message.to_string(), *oid));
        true
    })?;
    let mut out = Vec::new();
    for (index, message, oid) in raw {
        let time = repo
            .find_commit(oid)
            .map(|c| c.time().seconds() as f64)
            .unwrap_or(0.0);
        out.push(StashEntry {
            index: index as u32,
            oid: oid.to_string(),
            branch: stash_branch(&message),
            message,
            time,
        });
    }
    Ok(out)
}

/// Extracts the branch from "WIP on <branch>: ..." / "On <branch>: ...".
fn stash_branch(message: &str) -> Option<String> {
    let rest = message
        .strip_prefix("WIP on ")
        .or_else(|| message.strip_prefix("On "))?;
    let (branch, _) = rest.split_once(':')?;
    Some(branch.to_string())
}

pub fn refs_list(repo: &mut Repository) -> AppResult<RefsSnapshot> {
    Ok(RefsSnapshot {
        head: head_state(repo)?,
        local: branch_infos(repo, BranchType::Local)?,
        remote: branch_infos(repo, BranchType::Remote)?,
        tags: tag_infos(repo)?,
        stashes: stash_list(repo)?,
    })
}
