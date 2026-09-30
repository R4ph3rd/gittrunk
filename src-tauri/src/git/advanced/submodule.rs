//! Submodule listing (libgit2) and `git submodule update` arguments.

use git2::{Repository, SubmoduleStatus as Flags};

use super::{invalid, relative_path};
use crate::ipc::error::AppResult;
use crate::ipc::types::*;

pub fn list(repo: &Repository) -> AppResult<Vec<SubmoduleInfo>> {
    let mut out = Vec::new();
    for mut sm in repo.submodules()? {
        // Cached handles may predate changes made by other processes.
        let _ = sm.reload(true);
        let name = sm.name().unwrap_or_default().to_string();
        let flags = repo
            .submodule_status(&name, git2::SubmoduleIgnore::Unspecified)
            .unwrap_or(Flags::empty());
        let head = sm
            .workdir_id()
            .or_else(|| sm.index_id())
            .or_else(|| sm.head_id());
        out.push(SubmoduleInfo {
            path: sm.path().to_string_lossy().replace('\\', "/"),
            url: sm.url().ok().flatten().map(str::to_string),
            head_oid: head.map(|o| o.to_string()),
            status: match (
                classify(flags),
                sm.workdir_id(),
                sm.index_id().or_else(|| sm.head_id()),
            ) {
                // libgit2 may serve a cached status; compare commits directly.
                (SubmoduleStatus::UpToDate | SubmoduleStatus::Modified, Some(w), Some(r))
                    if w != r =>
                {
                    SubmoduleStatus::OutOfDate
                }
                (status, _, _) => status,
            },
            name,
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Not checked out -> uninitialized; checked-out commit differs from the
/// recorded one -> out of date; dirty workdir, untracked files or a changed
/// index entry -> modified; otherwise up to date.
pub fn classify(f: Flags) -> SubmoduleStatus {
    if f.contains(Flags::WD_UNINITIALIZED) || !f.contains(Flags::IN_WD) {
        SubmoduleStatus::Uninitialized
    } else if f.contains(Flags::WD_MODIFIED) {
        SubmoduleStatus::OutOfDate
    } else if f.intersects(
        Flags::INDEX_MODIFIED
            | Flags::WD_INDEX_MODIFIED
            | Flags::WD_WD_MODIFIED
            | Flags::WD_UNTRACKED,
    ) {
        SubmoduleStatus::Modified
    } else {
        SubmoduleStatus::UpToDate
    }
}

/// Arguments for `git submodule update`; paths go after `--`.
pub fn update_args(request: &SubmoduleUpdateRequest) -> AppResult<Vec<String>> {
    let mut args: Vec<String> = vec!["submodule".into(), "update".into(), "--progress".into()];
    if request.init {
        args.push("--init".into());
    }
    if request.recursive {
        args.push("--recursive".into());
    }
    args.push("--".into());
    for p in &request.paths {
        if p.trim().is_empty() {
            return Err(invalid("empty submodule path"));
        }
        args.push(relative_path(p)?);
    }
    Ok(args)
}
