//! Reflog of HEAD or a local branch (libgit2), newest first.

use git2::Repository;

use super::{clamp_limit, invalid};
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

/// `HEAD`, `refs/...` or a local branch short name.
pub fn full_ref_name(name: &str) -> AppResult<String> {
    let bad = name.is_empty() || name.starts_with('-') || name.contains('\0');
    let full = if name == "HEAD" {
        "HEAD".to_string()
    } else if name.starts_with("refs/") {
        name.to_string()
    } else {
        format!("refs/heads/{name}")
    };
    if bad || (full != "HEAD" && !git2::Reference::is_valid_name(&full)) {
        return Err(invalid(format!("`{name}` is not a valid ref name")));
    }
    Ok(full)
}

pub fn reflog(repo: &Repository, ref_name: &str, limit: u32) -> AppResult<Vec<ReflogEntry>> {
    let limit = clamp_limit(limit)?;
    let full = full_ref_name(ref_name)?;
    let log = repo.reflog(&full)?;
    Ok(log
        .iter()
        .take(limit)
        .enumerate()
        .map(|(i, e)| {
            let c = e.committer();
            ReflogEntry {
                index: i as u32,
                old_oid: e.id_old().to_string(),
                new_oid: e.id_new().to_string(),
                message: e.message().ok().flatten().unwrap_or_default().to_string(),
                committer: Signature {
                    name: c.name().unwrap_or_default().to_string(),
                    email: c.email().unwrap_or_default().to_string(),
                    time: c.when().seconds() as f64,
                    offset_minutes: c.when().offset_minutes(),
                },
            }
        })
        .collect())
}
