//! In-memory replay of picks, reverts and rebase todos, used for dry-run
//! previews. Nothing touches the working tree, the index or any ref; the
//! commits it builds only exist as unreferenced objects in the object
//! database (git's gc removes them). A replay stops at the first conflicting
//! step, so `conflicts` lists the paths of that step only: later steps depend
//! on its resolution and cannot be predicted.

use git2::{Commit, Index, Oid, Repository, Signature};

use crate::ipc::error::AppResult;

#[derive(Debug, Clone)]
pub(super) enum SimOp {
    Pick,
    Revert,
    Reword(String),
    /// Folds into the previous created commit; `Some` replaces the message.
    Squash(Option<String>),
    Fixup,
}

#[derive(Debug, Clone)]
pub(super) struct SimStep {
    pub oid: Oid,
    pub op: SimOp,
}

#[derive(Debug)]
pub(super) struct SimResult {
    /// Tip after the last step that was replayed.
    pub tip: Oid,
    /// Commits the operation creates (folded squashes do not count).
    pub created: u32,
    /// Conflicting paths of the first conflicting step (empty when clean).
    pub conflicts: Vec<String>,
}

pub(super) fn index_conflict_paths(index: &Index) -> AppResult<Vec<String>> {
    let mut paths = Vec::new();
    for c in index.conflicts()?.flatten() {
        if let Some(e) = c.our.or(c.their).or(c.ancestor) {
            paths.push(String::from_utf8_lossy(&e.path).into_owned());
        }
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn committer(repo: &Repository) -> Signature<'static> {
    repo.signature()
        .ok()
        .and_then(|s| Signature::now(s.name().unwrap_or("gittrunk"), s.email().unwrap_or("")).ok())
        .or_else(|| Signature::now("gittrunk", "gittrunk@localhost").ok())
        .expect("a signature can always be built")
}

pub(super) fn simulate(repo: &Repository, start: Oid, steps: &[SimStep]) -> AppResult<SimResult> {
    let sig = committer(repo);
    let mut tip = start;
    let mut created = 0u32;
    for step in steps {
        let commit = repo.find_commit(step.oid)?;
        let tip_commit = repo.find_commit(tip)?;
        let mainline = u32::from(commit.parent_count() > 1);
        let mut index = if matches!(step.op, SimOp::Revert) {
            repo.revert_commit(&commit, &tip_commit, mainline, None)?
        } else {
            repo.cherrypick_commit(&commit, &tip_commit, mainline, None)?
        };
        if index.has_conflicts() {
            return Ok(SimResult {
                tip,
                created,
                conflicts: index_conflict_paths(&index)?,
            });
        }
        let tree = repo.find_tree(index.write_tree_to(repo)?)?;
        let folds = matches!(step.op, SimOp::Squash(_) | SimOp::Fixup) && created > 0;
        if folds {
            let message = match &step.op {
                SimOp::Squash(Some(m)) => m.clone(),
                SimOp::Squash(None) => format!(
                    "{}\n\n{}",
                    tip_commit.message().unwrap_or("").trim_end(),
                    commit.message().unwrap_or("").trim_end()
                ),
                _ => tip_commit.message().unwrap_or("").to_string(),
            };
            let parents: Vec<Commit> = tip_commit.parents().collect();
            let refs: Vec<&Commit> = parents.iter().collect();
            tip = repo.commit(None, &tip_commit.author(), &sig, &message, &tree, &refs)?;
        } else {
            let message = match &step.op {
                SimOp::Reword(m) => m.clone(),
                SimOp::Revert => format!(
                    "Revert \"{}\"\n\nThis reverts commit {}.\n",
                    commit.summary().ok().flatten().unwrap_or(""),
                    commit.id()
                ),
                _ => commit.message().unwrap_or("").to_string(),
            };
            tip = repo.commit(
                None,
                &commit.author(),
                &sig,
                &message,
                &tree,
                &[&tip_commit],
            )?;
            created += 1;
        }
    }
    Ok(SimResult {
        tip,
        created,
        conflicts: Vec::new(),
    })
}
