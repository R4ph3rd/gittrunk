//! File history through `git log --follow --name-status` (rename aware).

use std::path::Path;

use super::{clamp_limit, relative_path};
use crate::git::cli::GitCli;
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

const RS: char = '\u{1e}';
const US: char = '\u{1f}';

pub fn args(path: &str, limit: u32) -> AppResult<Vec<String>> {
    let path = relative_path(path)?;
    let limit = clamp_limit(limit)?;
    Ok(vec![
        "--literal-pathspecs".into(),
        "log".into(),
        "--follow".into(),
        "--no-color".into(),
        format!("-n{limit}"),
        "--name-status".into(),
        format!("--format={RS}%H{US}%an{US}%at{US}%s"),
        "--".into(),
        path,
    ])
}

fn status_of(code: &str) -> ChangeStatus {
    match code.chars().next() {
        Some('A') => ChangeStatus::Added,
        Some('D') => ChangeStatus::Deleted,
        Some('R') => ChangeStatus::Renamed,
        Some('C') => ChangeStatus::Copied,
        Some('T') => ChangeStatus::TypeChange,
        _ => ChangeStatus::Modified,
    }
}

pub fn parse(text: &str, requested: &str) -> Vec<FileHistoryEntry> {
    let mut out = Vec::new();
    for record in text.split(RS).filter(|r| !r.trim().is_empty()) {
        let mut lines = record.lines();
        let Some(head) = lines.next() else { continue };
        let f: Vec<&str> = head.splitn(4, US).collect();
        if f.len() < 4 {
            continue;
        }
        let (mut path, mut status) = (requested.to_string(), ChangeStatus::Modified);
        if let Some(line) = lines.find(|l| !l.trim().is_empty()) {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 2 {
                status = status_of(cols[0]);
                path = cols[cols.len() - 1].to_string();
            }
        }
        out.push(FileHistoryEntry {
            commit: CommitSummary {
                oid: f[0].to_string(),
                short_oid: f[0].chars().take(7).collect(),
                summary: f[3].to_string(),
                author_name: f[1].to_string(),
                author_time: f[2].parse().unwrap_or(0.0),
            },
            path,
            status,
        });
    }
    out
}

pub fn file_history(
    cli: &GitCli,
    dir: &Path,
    path: &str,
    limit: u32,
) -> AppResult<Vec<FileHistoryEntry>> {
    let a = args(path, limit)?;
    let out = cli.run_read(dir, &a)?;
    Ok(parse(&out.stdout_str(), &relative_path(path)?))
}
