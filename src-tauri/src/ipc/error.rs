use serde::{Deserialize, Serialize};
use specta::Type;

/// Closed set of error categories the UI can branch on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    NotARepo,
    Conflict,
    DirtyWorktree,
    AuthRequired,
    AuthFailed,
    Network,
    RefNotFound,
    InvalidInput,
    GitCli,
    AiDisabled,
    AiProvider,
    Cancelled,
    Io,
    NotImplemented,
    Internal,
}

/// Error returned by every IPC command.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{kind:?}: {message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn not_implemented(command: &str) -> Self {
        Self::new(
            ErrorKind::NotImplemented,
            format!("`{command}` is not implemented yet"),
        )
    }
}

impl From<git2::Error> for AppError {
    fn from(err: git2::Error) -> Self {
        let kind = match err.code() {
            git2::ErrorCode::NotFound if err.class() == git2::ErrorClass::Repository => {
                ErrorKind::NotARepo
            }
            git2::ErrorCode::NotFound => ErrorKind::RefNotFound,
            git2::ErrorCode::Conflict | git2::ErrorCode::MergeConflict => ErrorKind::Conflict,
            git2::ErrorCode::Uncommitted | git2::ErrorCode::Modified => ErrorKind::DirtyWorktree,
            git2::ErrorCode::Auth => ErrorKind::AuthFailed,
            git2::ErrorCode::InvalidSpec | git2::ErrorCode::Invalid => ErrorKind::InvalidInput,
            _ => ErrorKind::Internal,
        };
        Self::new(kind, err.message().to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::new(ErrorKind::Io, err.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_camel_case() {
        let err = AppError::not_implemented("repo_open").with_detail("stub");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "notImplemented");
        assert_eq!(json["detail"], "stub");
    }

    #[test]
    fn maps_git2_not_found_repo() {
        let dir = tempfile::tempdir().unwrap();
        let Err(err) = git2::Repository::open(dir.path()) else {
            panic!("expected open to fail");
        };
        assert_eq!(AppError::from(err).kind, ErrorKind::NotARepo);
    }
}
