//! `.git/sequencer/` state of a multi-commit cherry-pick / revert, in git's
//! layout: `head` (where to return on abort), `todo` (`pick|revert <oid>
//! <subject>` per line, the stopped commit first) and `opts`. With the todo
//! present libgit2 reports `RepositoryState::*Sequence`.

use std::fs;
use std::path::PathBuf;

use git2::{Oid, Repository};

use super::pick::Kind;
use super::{git_file, AppResult};

fn dir(repo: &Repository) -> PathBuf {
    git_file(repo, "sequencer")
}

/// Whether a multi-commit sequence is in progress.
pub fn exists(repo: &Repository) -> bool {
    dir(repo).join("todo").is_file()
}

/// Starts a sequence: remembers HEAD and the options.
pub fn start(
    repo: &Repository,
    head: Oid,
    kind: Kind,
    items: &[Oid],
    mainline: Option<u32>,
) -> AppResult<()> {
    let d = dir(repo);
    fs::create_dir_all(&d)?;
    fs::write(d.join("head"), format!("{head}\n"))?;
    let mut opts = String::from("[options]\n");
    if let Some(m) = mainline {
        opts.push_str(&format!("\tmainline = {m}\n"));
    }
    fs::write(d.join("opts"), opts)?;
    write_todo(repo, kind, items)
}

/// Rewrites the todo with `items` (the commit about to be applied first).
pub fn write_todo(repo: &Repository, kind: Kind, items: &[Oid]) -> AppResult<()> {
    let mut text = String::new();
    for oid in items {
        let subject = repo
            .find_commit(*oid)
            .ok()
            .and_then(|c| c.summary().ok().flatten().map(str::to_string))
            .unwrap_or_default();
        text.push_str(&format!("{} {oid} {subject}\n", kind.todo_word()));
    }
    fs::write(dir(repo).join("todo"), text)?;
    Ok(())
}

/// Commits still to apply, in order.
pub fn read_todo(repo: &Repository) -> Vec<Oid> {
    let text = fs::read_to_string(dir(repo).join("todo")).unwrap_or_default();
    text.lines()
        .filter_map(|l| {
            let mut parts = l.split_whitespace();
            let _word = parts.next()?;
            let rev = parts.next()?;
            Oid::from_str(rev)
                .ok()
                .or_else(|| repo.revparse_single(rev).ok().map(|o| o.id()))
        })
        .collect()
}

/// The HEAD the sequence started from.
pub fn read_head(repo: &Repository) -> Option<Oid> {
    let text = fs::read_to_string(dir(repo).join("head")).ok()?;
    Oid::from_str(text.trim()).ok()
}

/// `-m <parent>` of the sequence.
pub fn read_mainline(repo: &Repository) -> Option<u32> {
    let text = fs::read_to_string(dir(repo).join("opts")).ok()?;
    text.lines().find_map(|l| {
        let (k, v) = l.split_once('=')?;
        (k.trim() == "mainline").then(|| v.trim().parse().ok())?
    })
}

/// Deletes the sequencer directory.
pub fn remove(repo: &Repository) {
    let _ = fs::remove_dir_all(dir(repo));
}
