//! Moves the repository from one snapshot to another (undo / redo).

use std::path::Path;

use git2::{Delta, Oid, Repository};

use super::snapshot::{self, config_key, parse, HeadSnap, Snapshot};
use crate::git::preview::{self, PlannedUpdate};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::OpPreview;

/// One path that has to change to get from tree `from` to tree `to`.
#[derive(Debug, Clone)]
pub(crate) struct PathChange {
    pub(crate) path: String,
    pub(crate) from: Option<(Oid, u32)>,
    pub(crate) to: Option<(Oid, u32)>,
}

pub(crate) fn tree_changes(
    repo: &Repository,
    from: Option<Oid>,
    to: Option<Oid>,
) -> AppResult<Vec<PathChange>> {
    let from_tree = from.map(|o| repo.find_tree(o)).transpose()?;
    let to_tree = to.map(|o| repo.find_tree(o)).transpose()?;
    let diff = repo.diff_tree_to_tree(from_tree.as_ref(), to_tree.as_ref(), None)?;
    let mut out = Vec::new();
    for delta in diff.deltas() {
        let side = |f: git2::DiffFile<'_>| (f.id(), u32::from(f.mode()));
        let (from, to) = match delta.status() {
            Delta::Added => (None, Some(side(delta.new_file()))),
            Delta::Deleted => (Some(side(delta.old_file())), None),
            _ => (Some(side(delta.old_file())), Some(side(delta.new_file()))),
        };
        let Some(path) = delta.new_file().path().or(delta.old_file().path()) else {
            continue;
        };
        out.push(PathChange {
            path: path.to_string_lossy().replace('\\', "/"),
            from,
            to,
        });
    }
    Ok(out)
}

/// Blob id of the working-tree entry at `rel` as git would record it: regular
/// files go through the clean filters (`core.autocrlf`, `.gitattributes`), so a
/// checked-out CRLF file hashes to its LF blob. `None` when nothing is there.
pub(crate) fn worktree_blob_id(repo: &Repository, workdir: &Path, rel: &str) -> Option<Oid> {
    let full = workdir.join(rel);
    let meta = std::fs::symlink_metadata(&full).ok()?;
    if meta.file_type().is_symlink() {
        let target = std::fs::read_link(&full).ok()?;
        return repo
            .blob(target.to_string_lossy().into_owned().as_bytes())
            .ok();
    }
    if meta.is_file() {
        return repo.blob_path(&full).ok();
    }
    None
}

/// Paths whose working-tree content is neither what `from` has nor what `to`
/// has: applying the change would overwrite local work.
fn dirty_paths(repo: &Repository, changes: &[PathChange]) -> AppResult<Vec<String>> {
    let Some(workdir) = repo.workdir() else {
        return Ok(Vec::new());
    };
    let mut dirty = Vec::new();
    for c in changes {
        let current = worktree_blob_id(repo, workdir, &c.path);
        if current != c.from.map(|f| f.0) && current != c.to.map(|t| t.0) {
            dirty.push(c.path.clone());
        }
    }
    Ok(dirty)
}

fn apply_changes(repo: &Repository, changes: &[PathChange]) -> AppResult<()> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::new(ErrorKind::InvalidInput, "repository has no working tree"))?
        .to_path_buf();
    for c in changes.iter().filter(|c| c.to.is_none()) {
        remove_file(&workdir, &c.path);
    }
    let mut index = git2::Index::new()?;
    let mut cb = git2::build::CheckoutBuilder::new();
    cb.force().disable_pathspec_match(true).update_index(false);
    let mut any = false;
    for c in changes {
        let Some((oid, mode)) = c.to else { continue };
        let full = workdir.join(&c.path);
        if let Ok(meta) = std::fs::symlink_metadata(&full) {
            if meta.is_dir() {
                std::fs::remove_dir_all(&full)?;
            } else {
                // Replaced below; also drops read-only or symlink leftovers.
                std::fs::remove_file(&full)?;
            }
        }
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let size = repo.find_blob(oid)?.size();
        index.add(&git2::IndexEntry {
            ctime: git2::IndexTime::new(0, 0),
            mtime: git2::IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode,
            uid: 0,
            gid: 0,
            file_size: size as u32,
            id: oid,
            flags: 0,
            flags_extended: 0,
            path: c.path.as_bytes().to_vec(),
        })?;
        cb.path(&c.path);
        any = true;
    }
    if any {
        // Checkout applies smudge filters, so the files match what git writes.
        repo.checkout_index(Some(&mut index), Some(&mut cb))?;
    }
    Ok(())
}

fn remove_file(workdir: &Path, rel: &str) {
    let full = workdir.join(rel);
    let _ = std::fs::remove_file(&full);
    let mut dir = full.parent().map(Path::to_path_buf);
    while let Some(d) = dir {
        if d == workdir || std::fs::remove_dir(&d).is_err() {
            break;
        }
        dir = d.parent().map(Path::to_path_buf);
    }
}

/// What restoring to `target` would do to the working tree.
struct WorktreePlan {
    changes: Vec<PathChange>,
    /// True when the target carries a full working-tree snapshot.
    full: bool,
}

fn plan_worktree(repo: &Repository, from: &Snapshot, target: &Snapshot) -> AppResult<WorktreePlan> {
    if repo.is_bare() {
        return Ok(WorktreePlan {
            changes: Vec::new(),
            full: false,
        });
    }
    if let Some(w) = &target.worktree {
        let target_tree = repo.find_commit(parse(w)?)?.tree_id();
        let current = snapshot::worktree_tree(repo)?;
        return Ok(WorktreePlan {
            changes: tree_changes(repo, Some(current), Some(target_tree))?,
            full: true,
        });
    }
    let from_tree = from.index_tree.as_deref().map(parse).transpose()?;
    let to_tree = target.index_tree.as_deref().map(parse).transpose()?;
    let changes = match (from_tree, to_tree) {
        (Some(_), Some(_)) => tree_changes(repo, from_tree, to_tree)?,
        _ => Vec::new(),
    };
    Ok(WorktreePlan {
        changes,
        full: false,
    })
}

fn dirty_error(paths: &[String]) -> AppError {
    let shown: Vec<&str> = paths.iter().take(5).map(String::as_str).collect();
    let more = if paths.len() > 5 {
        format!(" and {} more", paths.len() - 5)
    } else {
        String::new()
    };
    AppError::new(
        ErrorKind::DirtyWorktree,
        format!(
            "files changed since this operation would be overwritten: {}{more}",
            shown.join(", ")
        ),
    )
    .with_detail(paths.join("\n"))
}

/// Ref changes needed to go from the live state to `target`.
fn planned_updates(live: &Snapshot, target: &Snapshot) -> AppResult<Vec<PlannedUpdate>> {
    let mut out = Vec::new();
    let names: std::collections::BTreeSet<&String> =
        live.refs.keys().chain(target.refs.keys()).collect();
    for name in names {
        let a = live.refs.get(name);
        let b = target.refs.get(name);
        if a != b {
            out.push(PlannedUpdate::new(
                name.clone(),
                a.map(|s| parse(s)).transpose()?,
                b.map(|s| parse(s)).transpose()?,
            ));
        }
    }
    if live.head != target.head || live.head_oid != target.head_oid {
        if let (HeadSnap::Detached(_), _) | (_, HeadSnap::Detached(_)) = (&live.head, &target.head)
        {
            out.push(PlannedUpdate::new(
                "HEAD",
                live.head_oid.as_deref().map(parse).transpose()?,
                target.head_oid.as_deref().map(parse).transpose()?,
            ));
        }
    }
    Ok(out)
}

/// Dry run: what moving from the live state to `target` would do.
pub fn preview(
    repo: &Repository,
    verb: &str,
    description: &str,
    from: &Snapshot,
    target: &Snapshot,
) -> AppResult<OpPreview> {
    let live = snapshot::capture(repo, false)?;
    let planned = planned_updates(&live, target)?;
    let plan = plan_worktree(repo, from, target)?;
    let mut warnings = Vec::new();
    if plan.full {
        warnings.push("the working tree will be restored to its earlier state".to_string());
    } else {
        let dirty = dirty_paths(repo, &plan.changes)?;
        if !dirty.is_empty() {
            warnings.push(format!(
                "{} file(s) changed since the operation and block this {verb}: {}",
                dirty.len(),
                dirty.join(", ")
            ));
        }
    }
    if matches!(target.head, HeadSnap::Detached(_)) {
        warnings.push("HEAD will be detached".to_string());
    }
    preview::build(
        repo,
        format!("{verb}: {description}"),
        &planned,
        0,
        warnings,
        Vec::new(),
    )
}

/// Restores refs, HEAD, the index and the working tree to `target`. `from` is
/// the snapshot the repository is expected to be in (the entry's other side).
pub fn apply(repo: &Repository, from: &Snapshot, target: &Snapshot) -> AppResult<()> {
    let live = snapshot::capture(repo, false)?;
    let plan = plan_worktree(repo, from, target)?;
    if !plan.full {
        let dirty = dirty_paths(repo, &plan.changes)?;
        if !dirty.is_empty() {
            return Err(dirty_error(&dirty));
        }
    }
    apply_changes(repo, &plan.changes)?;

    for name in live.refs.keys().filter(|n| !target.refs.contains_key(*n)) {
        if let Ok(mut r) = repo.find_reference(name) {
            r.delete()?;
        }
    }
    for (name, oid) in &target.refs {
        if live.refs.get(name) != Some(oid) {
            repo.reference(name, parse(oid)?, true, "gittrunk: restore")?;
        }
    }
    match &target.head {
        HeadSnap::Symbolic(name) => repo.set_head(name)?,
        HeadSnap::Detached(oid) => repo.set_head_detached(parse(oid)?)?,
    }

    let mut config = repo.config()?;
    for name in target
        .refs
        .keys()
        .filter_map(|n| n.strip_prefix("refs/heads/"))
    {
        for key in ["remote", "merge"] {
            let full = config_key(name, key);
            match target.branch_config.get(name).and_then(|m| m.get(key)) {
                Some(v) => config.set_str(&full, v)?,
                None => {
                    let _ = config.remove(&full);
                }
            }
        }
    }

    if let Some(tree) = &target.index_tree {
        if !repo.is_bare() {
            let tree = repo.find_tree(parse(tree)?)?;
            let mut index = repo.index()?;
            index.read_tree(&tree)?;
            index.write()?;
        }
    }
    Ok(())
}
