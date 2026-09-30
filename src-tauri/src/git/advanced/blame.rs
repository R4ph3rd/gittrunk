//! Blame with libgit2 (`git_blame_file`). libgit2 follows whole-file
//! renames across commits (`orig_path` is the path in the blamed commit),
//! which is sufficient here; copy detection across files is not enabled.
//! The file content comes from the blob at `rev`, so line numbers match the
//! hunks exactly.

use std::collections::HashMap;
use std::path::Path;

use git2::{BlameOptions, Repository};

use super::{invalid, relative_path};
use crate::git::preview::commit_summary;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub fn blame(repo: &Repository, path: &str, rev: Option<&str>) -> AppResult<BlameResult> {
    let path = relative_path(path)?;
    let spec = rev.unwrap_or("HEAD");
    if spec.is_empty() || spec.starts_with('-') || spec.contains('\0') {
        return Err(invalid(format!("`{spec}` is not a valid revision")));
    }
    let commit = repo
        .revparse_single(spec)
        .and_then(|o| o.peel_to_commit())
        .map_err(|_| AppError::new(ErrorKind::RefNotFound, format!("cannot resolve `{spec}`")))?;
    let entry = commit
        .tree()?
        .get_path(Path::new(&path))
        .map_err(|_| invalid(format!("`{path}` does not exist at `{spec}`")))?;
    let blob = repo
        .find_blob(entry.id())
        .map_err(|_| invalid(format!("`{path}` is not a file at `{spec}`")))?;
    let text = String::from_utf8_lossy(blob.content()).into_owned();
    let lines: Vec<String> = text
        .split_terminator('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
        .collect();

    let mut opts = BlameOptions::new();
    opts.newest_commit(commit.id());
    let blame = repo.blame_file(Path::new(&path), Some(&mut opts))?;
    let mut summaries: HashMap<git2::Oid, (String, String, f64)> = HashMap::new();
    let mut hunks = Vec::with_capacity(blame.len());
    for h in blame.iter() {
        let oid = h.final_commit_id();
        let (summary, author, time) = match summaries.get(&oid) {
            Some(v) => v.clone(),
            None => {
                let c = repo.find_commit(oid)?;
                let s = commit_summary(&c);
                let v = (s.summary, s.author_name, s.author_time);
                summaries.insert(oid, v.clone());
                v
            }
        };
        let sig = h.final_signature();
        hunks.push(BlameHunk {
            oid: oid.to_string(),
            author_name: sig
                .and_then(|s| s.name().ok().map(str::to_string))
                .unwrap_or(author),
            author_time: time,
            summary,
            start_line: h.final_start_line() as u32,
            line_count: h.lines_in_hunk() as u32,
            orig_path: h
                .path()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|| path.clone()),
        });
    }
    Ok(BlameResult { path, lines, hunks })
}
