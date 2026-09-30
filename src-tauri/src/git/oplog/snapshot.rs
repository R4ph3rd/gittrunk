//! Repository snapshots: HEAD, every local branch and tag, the index as a
//! tree and (optionally) the whole working tree as a commit.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use git2::{
    Commit, Index, IndexEntry, IndexTime, ObjectType, Oid, Repository, Signature, StatusOptions,
};
use serde::{Deserialize, Serialize};

use crate::ipc::error::{AppError, AppResult, ErrorKind};

/// Where HEAD pointed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum HeadSnap {
    /// Full name of the branch HEAD is attached to (it may be unborn).
    Symbolic(String),
    Detached(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub head: HeadSnap,
    /// Commit HEAD resolved to (None when unborn).
    pub head_oid: Option<String>,
    /// Every local branch (`refs/heads/*`) and tag (`refs/tags/*`) -> target.
    pub refs: BTreeMap<String, String>,
    /// `remote` / `merge` settings of each branch, keyed by short name.
    #[serde(default)]
    pub branch_config: BTreeMap<String, BTreeMap<String, String>>,
    /// The index written as a tree (None for bare repos or conflicted indexes).
    pub index_tree: Option<String>,
    /// Commit holding tracked + untracked working-tree content.
    pub worktree: Option<String>,
}

pub(crate) fn parse(oid: &str) -> AppResult<Oid> {
    Oid::from_str(oid).map_err(|_| {
        AppError::new(
            ErrorKind::Internal,
            format!("corrupt oplog: bad object id `{oid}`"),
        )
    })
}

const CONFIG_KEYS: [&str; 2] = ["remote", "merge"];

pub(crate) fn config_key(branch: &str, key: &str) -> String {
    format!("branch.{branch}.{key}")
}

/// Captures the current state. `worktree` also builds the working-tree commit.
pub fn capture(repo: &Repository, worktree: bool) -> AppResult<Snapshot> {
    let head_ref = repo.find_reference("HEAD")?;
    let head = match head_ref.symbolic_target().ok().flatten() {
        Some(name) => HeadSnap::Symbolic(name.to_string()),
        None => HeadSnap::Detached(head_ref.target().map(|o| o.to_string()).unwrap_or_default()),
    };
    let head_oid = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id().to_string());

    let mut refs = BTreeMap::new();
    for r in repo.references()?.flatten() {
        let Ok(name) = r.name() else { continue };
        if name.starts_with("refs/heads/") || name.starts_with("refs/tags/") {
            if let Some(target) = r.target() {
                refs.insert(name.to_string(), target.to_string());
            }
        }
    }

    let config = repo.config()?;
    let mut branch_config = BTreeMap::new();
    for name in refs
        .keys()
        .filter_map(|n: &String| n.strip_prefix("refs/heads/"))
    {
        let mut values = BTreeMap::new();
        for key in CONFIG_KEYS {
            if let Ok(v) = config.get_string(&config_key(name, key)) {
                values.insert(key.to_string(), v);
            }
        }
        if !values.is_empty() {
            branch_config.insert(name.to_string(), values);
        }
    }

    let index_tree = if repo.is_bare() {
        None
    } else {
        let mut index = repo.index()?;
        index.read(true)?;
        if index.has_conflicts() {
            None
        } else {
            Some(index.write_tree()?.to_string())
        }
    };
    let worktree = if worktree && !repo.is_bare() {
        Some(worktree_commit(repo)?.to_string())
    } else {
        None
    };
    Ok(Snapshot {
        head,
        head_oid,
        refs,
        branch_config,
        index_tree,
        worktree,
    })
}

fn snapshot_signature() -> AppResult<Signature<'static>> {
    Ok(Signature::now("gittrunk", "gittrunk@localhost")?)
}

/// A commit whose tree is the working tree (tracked changes, deletions and
/// untracked, non-ignored files) with HEAD as parent. Neither the working
/// tree nor the index is modified.
pub fn worktree_commit(repo: &Repository) -> AppResult<Oid> {
    let tree_id = worktree_tree(repo)?;
    let tree = repo.find_tree(tree_id)?;
    let head: Option<Commit> = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&Commit> = head.iter().collect();
    let sig = snapshot_signature()?;
    Ok(repo.commit(
        None,
        &sig,
        &sig,
        "gittrunk: worktree snapshot",
        &tree,
        &parents,
    )?)
}

/// Tree of the current working-tree content.
pub fn worktree_tree(repo: &Repository) -> AppResult<Oid> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::new(ErrorKind::InvalidInput, "repository has no working tree"))?
        .to_path_buf();
    let mut real = repo.index()?;
    real.read(true)?;
    let mut mem = Index::new()?;
    for entry in real.iter() {
        if (entry.flags >> 12) & 0x3 == 0 {
            mem.add(&entry)?;
        }
    }

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .include_unmodified(false);
    let statuses = repo.statuses(Some(&mut opts))?;
    for entry in statuses.iter() {
        let st = entry.status();
        if st.is_conflicted() {
            continue;
        }
        let Ok(path) = entry.path() else { continue };
        let changed = git2::Status::WT_NEW
            | git2::Status::WT_MODIFIED
            | git2::Status::WT_TYPECHANGE
            | git2::Status::WT_RENAMED;
        if st.contains(git2::Status::WT_DELETED) {
            let _ = mem.remove_path(Path::new(path));
        } else if st.intersects(changed) {
            add_worktree_file(repo, &mut mem, &workdir, path)?;
        }
    }
    Ok(mem.write_tree_to(repo)?)
}

fn add_worktree_file(
    repo: &Repository,
    index: &mut Index,
    workdir: &Path,
    rel: &str,
) -> AppResult<()> {
    let full = workdir.join(rel);
    let Ok(meta) = std::fs::symlink_metadata(&full) else {
        return Ok(());
    };
    let (mode, data) = if meta.file_type().is_symlink() {
        let target = std::fs::read_link(&full)?;
        (0o120000, target.to_string_lossy().into_owned().into_bytes())
    } else if meta.is_file() {
        (file_mode(&meta), std::fs::read(&full)?)
    } else {
        // Directories (nested repositories) are not captured.
        return Ok(());
    };
    let id = repo.blob(&data)?;
    index.add(&IndexEntry {
        ctime: IndexTime::new(0, 0),
        mtime: IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode,
        uid: 0,
        gid: 0,
        file_size: data.len() as u32,
        id,
        flags: 0,
        flags_extended: 0,
        path: rel.as_bytes().to_vec(),
    })?;
    Ok(())
}

#[cfg(unix)]
fn file_mode(meta: &std::fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    if meta.permissions().mode() & 0o111 != 0 {
        0o100755
    } else {
        0o100644
    }
}

#[cfg(not(unix))]
fn file_mode(_meta: &std::fs::Metadata) -> u32 {
    0o100644
}

/// Pins every object of `snap` under `refs/gittrunk/oplog/<id>/<label>...` so
/// garbage collection cannot remove them.
pub fn pin(repo: &Repository, id: &str, label: &str, snap: &Snapshot) -> AppResult<()> {
    let mut parents: Vec<Oid> = Vec::new();
    let mut seen = HashSet::new();
    let mut loose: Vec<Oid> = Vec::new();
    let mut targets: Vec<&String> = snap.refs.values().collect();
    targets.extend(snap.head_oid.iter());
    targets.extend(snap.worktree.iter());
    for t in targets {
        let oid = parse(t)?;
        if !seen.insert(oid) {
            continue;
        }
        match repo.find_object(oid, None) {
            Ok(obj) if obj.kind() == Some(ObjectType::Commit) => parents.push(oid),
            Ok(_) => loose.push(oid),
            Err(_) => {} // dangling ref: nothing to pin
        }
    }
    let tree = match &snap.index_tree {
        Some(t) => repo.find_tree(parse(t)?)?,
        None => repo.find_tree(repo.treebuilder(None)?.write()?)?,
    };
    let commits: Vec<Commit> = parents
        .iter()
        .map(|o| repo.find_commit(*o))
        .collect::<Result<_, _>>()?;
    let refs: Vec<&Commit> = commits.iter().collect();
    let sig = snapshot_signature()?;
    let pin_commit = repo.commit(
        None,
        &sig,
        &sig,
        &format!("gittrunk: oplog {id} {label}"),
        &tree,
        &refs,
    )?;
    let prefix = format!("refs/gittrunk/oplog/{id}");
    repo.reference(&format!("{prefix}/{label}"), pin_commit, true, "oplog pin")?;
    for (n, oid) in loose.iter().enumerate() {
        repo.reference(&format!("{prefix}/{label}-obj{n}"), *oid, true, "oplog pin")?;
    }
    Ok(())
}
