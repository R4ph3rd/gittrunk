//! Walks history according to a `GraphFilter` and lays out the rows.

use std::collections::{HashMap, HashSet};

use git2::{Commit, ObjectType, Oid, Repository, Sort};

use super::{layout, CachedRow, GraphCache};
use crate::git::libgit::refs::ref_labels;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::{CommitOrder, GraphFilter};

pub fn build(repo: &Repository, filter: &GraphFilter) -> AppResult<GraphCache> {
    let mut walk = repo.revwalk()?;
    walk.set_sorting(match filter.order {
        CommitOrder::Topo => Sort::TOPOLOGICAL,
        CommitOrder::Date => Sort::TOPOLOGICAL | Sort::TIME,
    })?;
    if filter.first_parent {
        walk.simplify_first_parent()?;
    }
    for tip in start_points(repo, filter)? {
        walk.push(tip)?;
    }

    let author = filter
        .author
        .as_deref()
        .map(str::trim)
        .filter(|a| !a.is_empty())
        .map(str::to_lowercase);
    let path = filter
        .path
        .as_deref()
        .map(|p| p.replace('\\', "/"))
        .filter(|p| !p.is_empty());

    let mut oids: Vec<Oid> = Vec::new();
    let mut rows: Vec<CachedRow> = Vec::new();

    for id in walk {
        let id = id?;
        let commit = repo.find_commit(id)?;
        let author_sig = commit.author();
        let name = String::from_utf8_lossy(author_sig.name_bytes()).into_owned();
        let email = String::from_utf8_lossy(author_sig.email_bytes()).into_owned();

        if let Some(needle) = &author {
            if !name.to_lowercase().contains(needle) && !email.to_lowercase().contains(needle) {
                continue;
            }
        }
        let time = commit.time().seconds() as f64;
        if filter.since.is_some_and(|s| time < s) || filter.until.is_some_and(|u| time > u) {
            continue;
        }
        if let Some(p) = &path {
            if !touches_path(&commit, p)? {
                continue;
            }
        }

        rows.push(CachedRow {
            oid: id,
            parents: commit.parent_ids().collect(),
            lane: 0,
            color: 0,
            edges: Vec::new(),
            summary: String::from_utf8_lossy(commit.summary_bytes().unwrap_or_default())
                .into_owned(),
            author_name: name,
            author_email: email,
            author_time: author_sig.when().seconds() as f64,
        });
        oids.push(id);
    }

    let index: HashMap<Oid, u32> = oids
        .iter()
        .enumerate()
        .map(|(i, o)| (*o, i as u32))
        .collect();
    let laid_out = layout::compute(&oids, &|i| rows[i].parents.as_slice(), &|p| {
        index.contains_key(p)
    });
    for (row, l) in rows.iter_mut().zip(laid_out.rows) {
        row.lane = l.lane;
        row.color = l.color;
        row.edges = l.edges;
    }

    let head_row = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .and_then(|oid| index.get(&oid).copied());

    let cache = GraphCache {
        rows,
        lane_count: laid_out.lane_count,
        head_row,
        labels: ref_labels(repo)?,
    };
    Ok(cache)
}

/// Commits touched by `path` differ from every parent at that path
/// (a commit identical to any parent there is skipped, like `git log -- path`).
fn touches_path(commit: &Commit, path: &str) -> AppResult<bool> {
    let entry = |c: &Commit| -> AppResult<Option<(Oid, i32)>> {
        Ok(c.tree()?
            .get_path(std::path::Path::new(path))
            .ok()
            .map(|e| (e.id(), e.filemode())))
    };
    let here = entry(commit)?;
    if commit.parent_count() == 0 {
        return Ok(here.is_some());
    }
    for parent in commit.parents() {
        if entry(&parent)? == here {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Commit ids the walk starts from: every branch, remote branch, tag and HEAD
/// (stashes excluded), or the refs named in the filter.
fn start_points(repo: &Repository, filter: &GraphFilter) -> AppResult<Vec<Oid>> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut add = |oid: Oid| {
        if seen.insert(oid) {
            out.push(oid);
        }
    };
    match &filter.refs {
        Some(names) => {
            for name in names {
                let obj = repo.revparse_single(name).map_err(|_| {
                    AppError::new(ErrorKind::RefNotFound, format!("unknown ref `{name}`"))
                })?;
                let commit = obj.peel(ObjectType::Commit).map_err(|_| {
                    AppError::new(
                        ErrorKind::InvalidInput,
                        format!("`{name}` does not point to a commit"),
                    )
                })?;
                add(commit.id());
            }
        }
        None => {
            if let Ok(head) = repo.head() {
                if let Some(oid) = head.target() {
                    add(oid);
                }
            }
            for r in repo.references()? {
                let r = r?;
                let Ok(name) = r.name() else { continue };
                let wanted = name.starts_with("refs/heads/")
                    || name.starts_with("refs/remotes/")
                    || name.starts_with("refs/tags/");
                if !wanted {
                    continue;
                }
                if let Ok(obj) = r.peel(ObjectType::Commit) {
                    add(obj.id());
                }
            }
        }
    }
    Ok(out)
}
