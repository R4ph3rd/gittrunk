//! Validation of user-supplied values before they reach the git CLI. Values
//! are additionally placed after `--` where git accepts it, so a value such as
//! `--upload-pack=...` can never become an option.

use crate::ipc::error::{AppError, AppResult, ErrorKind};

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

/// Strict remote name: `[A-Za-z0-9_][A-Za-z0-9._-]*`.
pub fn remote_name(name: &str) -> AppResult<()> {
    let ok = !name.is_empty()
        && name.len() <= 100
        && name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && !name.contains("..")
        && !name.ends_with('.')
        && !name.ends_with(".lock");
    if ok {
        Ok(())
    } else {
        Err(invalid(format!("`{name}` is not a valid remote name")))
    }
}

/// Remote URL or local path: never an option, no control characters, and no
/// transports that run commands.
pub fn url(url: &str) -> AppResult<()> {
    let lower = url.trim_start().to_ascii_lowercase();
    if url.trim().is_empty()
        || lower.starts_with('-')
        || url.chars().any(char::is_control)
        || lower.starts_with("ext::")
        || lower.starts_with("fd::")
    {
        return Err(invalid(format!(
            "`{}` is not a valid remote URL",
            url.escape_debug()
        )));
    }
    Ok(())
}

/// Branch or short ref name (no leading `-`, valid per `git check-ref-format`).
pub fn branch(name: &str) -> AppResult<()> {
    if !name.starts_with('-') && git2::Branch::name_is_valid(name).unwrap_or(false) {
        Ok(())
    } else {
        Err(invalid(format!("`{name}` is not a valid branch name")))
    }
}

fn ref_side(side: &str) -> bool {
    !side.starts_with('-')
        && (side == "HEAD"
            || git2::Reference::is_valid_name(side)
            || git2::Reference::is_valid_name(&format!("refs/heads/{side}")))
}

/// Push refspec `name`, `src:dst` or `:dst` (deletion). A leading `+` (force)
/// is rejected: forcing goes through `--force-with-lease` only. No globs.
pub fn refspec(spec: &str) -> AppResult<()> {
    let bad = || invalid(format!("`{spec}` is not a valid refspec"));
    if spec.is_empty() || spec.starts_with('+') || spec.starts_with('-') {
        return Err(bad());
    }
    match spec.split_once(':') {
        None => ref_side(spec).then_some(()).ok_or_else(bad),
        Some((src, dst)) => {
            let src_ok = src.is_empty() || ref_side(src);
            let dst_ok = !dst.is_empty() && ref_side(dst);
            (src_ok && dst_ok).then_some(()).ok_or_else(bad)
        }
    }
}
