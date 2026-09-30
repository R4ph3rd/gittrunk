//! Operation journal with undo / redo.
//!
//! Every mutating operation is bracketed by two snapshots (see
//! `snapshot.rs`) and appended to `<gitdir>/gittrunk/oplog.jsonl`. Snapshot
//! objects are pinned under `refs/gittrunk/oplog/<id>/` so GC keeps them.
//! Undo restores the `before` snapshot, redo the `after` snapshot.

pub(crate) mod restore;
pub mod snapshot;

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use git2::Repository;
use serde::{Deserialize, Serialize};

use crate::git::libgit::repo::head_state;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::{OpOutcome, OplogEntry};

pub use snapshot::{HeadSnap, Snapshot};

/// One journal line.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct JournalEntry {
    id: String,
    /// Unix seconds.
    time: f64,
    operation: String,
    description: String,
    undone: bool,
    /// A new operation was recorded after this entry was undone: no redo.
    #[serde(default)]
    superseded: bool,
    before: Snapshot,
    after: Snapshot,
}

impl JournalEntry {
    fn to_wire(&self) -> OplogEntry {
        OplogEntry {
            id: self.id.clone(),
            time: self.time,
            operation: self.operation.clone(),
            description: self.description.clone(),
            head_before: self.before.head_oid.clone(),
            head_after: self.after.head_oid.clone(),
            undone: self.undone,
        }
    }
}

fn next_id() -> String {
    static LAST: AtomicU64 = AtomicU64::new(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut prev = LAST.load(Ordering::SeqCst);
    loop {
        let next = now.max(prev + 1);
        match LAST.compare_exchange(prev, next, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return format!("{next:013}"),
            Err(p) => prev = p,
        }
    }
}

fn journal_path(repo: &Repository) -> PathBuf {
    repo.path().join("gittrunk").join("oplog.jsonl")
}

fn read_journal(repo: &Repository) -> AppResult<Vec<JournalEntry>> {
    let path = journal_path(repo);
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    // A torn last line (crash mid-append) is skipped, not fatal.
    Ok(text
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect())
}

fn write_journal(repo: &Repository, entries: &[JournalEntry]) -> AppResult<()> {
    let path = journal_path(repo);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("jsonl.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        for e in entries {
            let line = serde_json::to_string(e).map_err(internal)?;
            f.write_all(line.as_bytes())?;
            f.write_all(b"\n")?;
        }
        f.sync_all()?;
    }
    fs::rename(&tmp, &path)?;
    Ok(())
}

fn append_journal(repo: &Repository, entry: &JournalEntry) -> AppResult<()> {
    let path = journal_path(repo);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut line = serde_json::to_string(entry).map_err(internal)?;
    line.push('\n');
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    f.write_all(line.as_bytes())?;
    f.sync_all()?;
    Ok(())
}

fn internal(e: serde_json::Error) -> AppError {
    AppError::new(ErrorKind::Internal, format!("oplog: {e}"))
}

/// Journal facade; all functions operate on one repository.
pub struct Oplog;

impl Oplog {
    /// Snapshots, runs `f`, snapshots again and journals the operation.
    /// Nothing is journaled when `f` fails.
    pub fn record<T>(
        repo: &Repository,
        operation: &str,
        description: String,
        capture_worktree: bool,
        f: impl FnOnce(&Repository) -> AppResult<T>,
    ) -> AppResult<(T, OplogEntry)> {
        let before = snapshot::capture(repo, capture_worktree)?;
        let value = f(repo)?;
        let after = snapshot::capture(repo, capture_worktree)?;
        let id = next_id();
        snapshot::pin(repo, &id, "before", &before)?;
        snapshot::pin(repo, &id, "after", &after)?;
        let entry = JournalEntry {
            id,
            time: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0),
            operation: operation.to_string(),
            description,
            undone: false,
            superseded: false,
            before,
            after,
        };
        let mut entries = read_journal(repo)?;
        if entries.iter().any(|e| e.undone && !e.superseded) {
            for e in entries.iter_mut().filter(|e| e.undone) {
                e.superseded = true;
            }
            entries.push(entry.clone());
            write_journal(repo, &entries)?;
        } else {
            append_journal(repo, &entry)?;
        }
        Ok((value, entry.to_wire()))
    }

    /// Newest first.
    pub fn list(repo: &Repository, limit: usize) -> AppResult<Vec<OplogEntry>> {
        Ok(read_journal(repo)?
            .iter()
            .rev()
            .take(limit)
            .map(JournalEntry::to_wire)
            .collect())
    }

    /// Reverts the most recent operation that is not undone.
    pub fn undo(repo: &Repository, dry_run: bool) -> AppResult<OpOutcome> {
        Self::step(repo, dry_run, true)
    }

    /// Reapplies the most recently undone operation.
    pub fn redo(repo: &Repository, dry_run: bool) -> AppResult<OpOutcome> {
        Self::step(repo, dry_run, false)
    }

    fn step(repo: &Repository, dry_run: bool, undo: bool) -> AppResult<OpOutcome> {
        let mut entries = read_journal(repo)?;
        let idx = if undo {
            entries.iter().rposition(|e| !e.undone)
        } else {
            entries.iter().rposition(|e| e.undone && !e.superseded)
        }
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::InvalidInput,
                if undo {
                    "nothing to undo"
                } else {
                    "nothing to redo"
                },
            )
        })?;
        let entry = entries[idx].clone();
        let (from, target, verb) = if undo {
            (&entry.after, &entry.before, "Undo")
        } else {
            (&entry.before, &entry.after, "Redo")
        };
        if dry_run {
            let preview = restore::preview(repo, verb, &entry.description, from, target)?;
            return Ok(OpOutcome::Preview { preview });
        }
        restore::apply(repo, from, target)?;
        entries[idx].undone = undo;
        write_journal(repo, &entries)?;
        Ok(OpOutcome::Applied {
            oplog_id: entry.id.clone(),
            head: head_state(repo)?,
            message: format!("{verb}: {}", entry.description),
        })
    }
}

#[cfg(test)]
mod tests;
