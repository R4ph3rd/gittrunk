//! Path-level working-copy helpers behind the Changes panel context menu:
//! ignore patterns, untracking, external difftool and patch export.

use std::fs;
use std::io::ErrorKind as IoKind;
use std::path::PathBuf;

use git2::{DiffFormat, Repository};

use super::{applied, clean_path, clean_paths, invalid, plural, workdir};
use crate::git::cli::GitCli;
use crate::git::oplog::Oplog;
use crate::git::preview;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::{IgnoreAddResult, IgnoreTarget, OpOutcome};

fn ignore_file(repo: &Repository, target: IgnoreTarget) -> AppResult<(PathBuf, &'static str)> {
    match target {
        IgnoreTarget::Gitignore => Ok((workdir(repo)?.join(".gitignore"), ".gitignore")),
        IgnoreTarget::Exclude => Ok((
            repo.commondir().join("info").join("exclude"),
            ".git/info/exclude",
        )),
    }
}

fn validate_pattern(p: &str) -> AppResult<()> {
    if p.trim().is_empty()
        || p.contains(['\n', '\r', '\0'])
        || p.starts_with('#')
        || (p.ends_with(' ') && !p.ends_with("\\ "))
    {
        return Err(invalid(format!("`{p}` is not a valid ignore pattern")));
    }
    Ok(())
}

/// Appends `text` (already newline-terminated lines) to `existing`, making
/// sure the previous last line ends with the file's own line ending.
fn append_lines(existing: &[u8], lines: &[String]) -> Vec<u8> {
    let crlf = existing.windows(2).any(|w| w == b"\r\n");
    let eol: &[u8] = if crlf { b"\r\n" } else { b"\n" };
    let mut out = existing.to_vec();
    if !out.is_empty() && !out.ends_with(b"\n") {
        out.extend_from_slice(eol);
    }
    for l in lines {
        out.extend_from_slice(l.as_bytes());
        out.extend_from_slice(eol);
    }
    out
}

/// Tracked files that the (not yet written) `added` patterns newly ignore.
fn newly_ignored_tracked(repo: &Repository, added: &[String]) -> AppResult<Vec<String>> {
    let mut index = repo.index()?;
    index.read(false)?;
    let paths: Vec<String> = index
        .iter()
        .filter(|e| (e.flags >> 12) & 0x3 == 0)
        .map(|e| String::from_utf8_lossy(&e.path).into_owned())
        .collect();
    let result = (|| -> AppResult<Vec<String>> {
        repo.clear_ignore_rules()?;
        repo.add_ignore_rule(&added.join("\n"))?;
        let mut hit = Vec::new();
        for p in &paths {
            if repo.is_path_ignored(p)? {
                hit.push(p.clone());
            }
        }
        repo.clear_ignore_rules()?;
        // Drop files an existing rule already ignored.
        let mut fresh = Vec::new();
        for p in hit {
            if !repo.is_path_ignored(&p)? {
                fresh.push(p);
            }
        }
        Ok(fresh)
    })();
    let _ = repo.clear_ignore_rules();
    result
}

/// Appends `patterns` to `.gitignore` or `.git/info/exclude`, skipping ones
/// already present. With `dry_run` nothing is written.
pub fn ignore_add(
    repo: &Repository,
    patterns: &[String],
    target: IgnoreTarget,
    dry_run: bool,
) -> AppResult<IgnoreAddResult> {
    workdir(repo)?;
    if patterns.is_empty() {
        return Err(invalid("no ignore patterns given"));
    }
    for p in patterns {
        validate_pattern(p)?;
    }
    let (file, display) = ignore_file(repo, target)?;
    let existing = match fs::read(&file) {
        Ok(b) => b,
        Err(e) if e.kind() == IoKind::NotFound => Vec::new(),
        Err(e) => return Err(e.into()),
    };
    let text = String::from_utf8_lossy(&existing);
    let present: Vec<&str> = text.lines().collect();
    let mut added: Vec<String> = Vec::new();
    let mut already_present = Vec::new();
    for p in patterns {
        if present.contains(&p.as_str()) {
            if !already_present.contains(p) {
                already_present.push(p.clone());
            }
        } else if !added.contains(p) {
            added.push(p.clone());
        }
    }
    let tracked = if added.is_empty() {
        Vec::new()
    } else {
        newly_ignored_tracked(repo, &added)?
    };
    if !dry_run && !added.is_empty() {
        let description = format!(
            "Ignore {} in {display}",
            plural(added.len(), "pattern", "patterns")
        );
        Oplog::record(repo, "ignore_add", description, false, |_| {
            if let Some(dir) = file.parent() {
                fs::create_dir_all(dir)?;
            }
            fs::write(&file, append_lines(&existing, &added))?;
            Ok(())
        })?;
    }
    Ok(IgnoreAddResult {
        file: display.to_string(),
        added,
        already_present,
        tracked,
    })
}

/// `git rm --cached` for files and folders: drops them from the index and
/// leaves the working tree alone.
pub fn untrack_paths(repo: &Repository, paths: &[String], dry_run: bool) -> AppResult<OpOutcome> {
    workdir(repo)?;
    let paths = clean_paths(paths)?;
    if paths.is_empty() {
        return Err(invalid("no paths given"));
    }
    let mut index = repo.index()?;
    index.read(true)?;
    let mut targets = Vec::new();
    for p in &paths {
        let prefix = format!("{p}/");
        let before = targets.len();
        for e in index.iter() {
            let path = String::from_utf8_lossy(&e.path).into_owned();
            if (path == *p || path.starts_with(&prefix)) && !targets.contains(&path) {
                targets.push(path);
            }
        }
        if targets.len() == before {
            return Err(invalid(format!("`{p}` is not tracked")));
        }
    }
    let summary = format!("Stop tracking {}", plural(targets.len(), "file", "files"));
    if dry_run {
        let warnings = vec![
            "The files stay in the working tree; their removal is staged for the next commit."
                .to_string(),
        ];
        let preview = preview::build(repo, summary, &[], 0, warnings, Vec::new())?;
        return Ok(OpOutcome::Preview { preview });
    }
    let ((), entry) = Oplog::record(repo, "untrack_paths", summary.clone(), false, |repo| {
        let mut index = repo.index()?;
        index.read(true)?;
        for t in &targets {
            // Also drops conflict stages.
            let _ = index.remove_path(std::path::Path::new(t));
        }
        index.write()?;
        Ok(())
    })?;
    applied(repo, entry.id, summary)
}

/// Opens `git difftool` for one path, detached from the UI.
pub fn difftool_open(repo: &Repository, cli: &GitCli, path: &str, staged: bool) -> AppResult<()> {
    let dir = workdir(repo)?;
    let path = clean_path(path)?;
    let cfg = repo.config()?;
    let configured = ["diff.tool", "merge.tool"]
        .iter()
        .any(|k| cfg.get_string(k).is_ok_and(|v| !v.trim().is_empty()));
    if !configured {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            "No diff tool is configured. Set one with `git config --global diff.tool <tool>` (for example meld, kdiff3 or vscode).",
        ));
    }
    let mut args = vec!["difftool".to_string(), "--no-prompt".to_string()];
    if staged {
        args.push("--cached".into());
    }
    args.push("--".into());
    args.push(path);
    cli.spawn_detached(dir, &args)
}

/// Unified diff (binary-safe) of `paths`: HEAD to index when `staged`,
/// otherwise index to working tree including untracked files.
pub fn diff_patch(repo: &Repository, paths: &[String], staged: bool) -> AppResult<Vec<u8>> {
    workdir(repo)?;
    let paths = clean_paths(paths)?;
    if paths.is_empty() {
        return Err(invalid("no paths given"));
    }
    repo.index()?.read(false)?;
    let mut opts = git2::DiffOptions::new();
    opts.show_binary(true).disable_pathspec_match(true);
    for p in &paths {
        opts.pathspec(p);
    }
    let diff = if staged {
        let tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(tree.as_ref(), None, Some(&mut opts))?
    } else {
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };
    let mut out = Vec::new();
    diff.print(DiffFormat::Patch, |_, _, line| {
        if matches!(line.origin(), '+' | '-' | ' ') {
            out.push(line.origin() as u8);
        }
        out.extend_from_slice(line.content());
        true
    })?;
    Ok(out)
}

/// Writes the patch for `paths` to `dest` (chosen by the user in a save dialog).
pub fn diff_patch_save(
    repo: &Repository,
    paths: &[String],
    staged: bool,
    dest: &str,
) -> AppResult<u32> {
    if dest.trim().is_empty() || dest.contains('\0') {
        return Err(invalid("no destination file given"));
    }
    let patch = diff_patch(repo, paths, staged)?;
    if patch.is_empty() {
        return Err(invalid("there are no changes to export"));
    }
    fs::write(dest, &patch)?;
    Ok(u32::try_from(patch.len()).unwrap_or(u32::MAX))
}

#[cfg(test)]
#[path = "files_tests.rs"]
mod files_tests;
