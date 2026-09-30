//! `commit_create` through the git CLI so hooks, signing and templates behave
//! exactly like `git commit`.

use git2::Repository;

use crate::git::cli::{CliOptions, GitCli};
use crate::git::libgit::repo::head_state;
use crate::git::oplog::Oplog;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::{CommitRequest, OpOutcome};

/// Environment that keeps git from ever waiting for an editor.
pub(crate) fn no_editor_env() -> Vec<(String, String)> {
    vec![
        ("GIT_EDITOR".into(), "true".into()),
        ("GIT_MERGE_AUTOEDIT".into(), "no".into()),
    ]
}

/// Fails with a clear message when `user.name` / `user.email` are missing.
pub(crate) fn check_identity(config: &git2::Config) -> AppResult<()> {
    let has = |key: &str| {
        config
            .get_string(key)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false)
    };
    let mut missing = Vec::new();
    if !has("user.name") {
        missing.push("user.name");
    }
    if !has("user.email") {
        missing.push("user.email");
    }
    if missing.is_empty() {
        return Ok(());
    }
    Err(AppError::new(
        ErrorKind::InvalidInput,
        format!(
            "Git identity is not configured: set {} (git config user.name \"Your Name\", git config user.email you@example.com)",
            missing.join(" and ")
        ),
    ))
}

fn short_head(repo: &Repository) -> String {
    repo.head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id().to_string()[..7].to_string())
        .unwrap_or_default()
}

pub(crate) fn commit_create(
    repo: &Repository,
    cli: &GitCli,
    request: &CommitRequest,
) -> AppResult<OpOutcome> {
    let workdir = repo.workdir().ok_or_else(|| {
        AppError::new(
            ErrorKind::InvalidInput,
            "cannot commit in a bare repository",
        )
    })?;
    if request.message.trim().is_empty() {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            "commit message must not be empty",
        ));
    }
    check_identity(&repo.config()?)?;
    if request.amend && repo.head().is_err() {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            "nothing to amend: the repository has no commits yet",
        ));
    }
    let mut args: Vec<&str> = vec!["commit", "-F", "-"];
    if request.amend {
        args.push("--amend");
    }
    if request.sign_off {
        args.push("--signoff");
    }
    if request.allow_empty {
        args.push("--allow-empty");
    }
    let opts = CliOptions {
        stdin: Some(request.message.clone().into_bytes()),
        read_only: false,
        env: no_editor_env(),
    };
    let description = if request.amend {
        "Amend commit"
    } else {
        "Commit"
    };
    let summary = request
        .message
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    let ((), entry) = Oplog::record(
        repo,
        "commit_create",
        format!("{description}: {summary}"),
        false,
        |_| {
            let out = cli.run_raw(workdir, &args, &opts)?;
            if out.success() {
                return Ok(());
            }
            let all = format!("{}\n{}", out.stdout_str(), out.stderr);
            if all.contains("nothing to commit")
                || all.contains("nothing added to commit")
                || all.contains("no changes added to commit")
            {
                return Err(AppError::new(
                    ErrorKind::InvalidInput,
                    "nothing to commit: stage some changes or allow an empty commit",
                ));
            }
            let first = all
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .unwrap_or("git commit failed")
                .to_string();
            Err(AppError::new(ErrorKind::GitCli, first).with_detail(all))
        },
    )?;
    Ok(OpOutcome::Applied {
        oplog_id: entry.id,
        head: head_state(repo)?,
        message: format!("Committed {}", short_head(repo)),
    })
}
