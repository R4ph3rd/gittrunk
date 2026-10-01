//! Forge token storage (service `gittrunk-forge`, account = host) and token
//! resolution with a fallback to the remembered HTTPS git credential.
//! Tokens are never logged or returned to the UI.

use crate::git::remote::keychain::SecretStore;
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::ForgeTokenSource;

pub const KEYCHAIN_SERVICE: &str = "gittrunk-forge";

/// Secret storage for forge tokens (tests use an in-memory fake).
pub trait ForgeTokens: Send + Sync {
    fn get(&self, host: &str) -> Option<String>;
    fn set(&self, host: &str, token: &str) -> AppResult<()>;
    /// Clearing a missing token is not an error.
    fn clear(&self, host: &str) -> AppResult<()>;
}

/// The OS keychain on desktop, the file store under `embedded_git`.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemTokens;

#[cfg(not(embedded_git))]
fn entry(host: &str) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(KEYCHAIN_SERVICE, host)
}

#[cfg(not(embedded_git))]
fn store_error(e: keyring::Error) -> AppError {
    AppError::new(ErrorKind::Internal, format!("keychain: {e}"))
}

#[cfg(not(embedded_git))]
impl ForgeTokens for SystemTokens {
    fn get(&self, host: &str) -> Option<String> {
        entry(host).ok()?.get_password().ok()
    }

    fn set(&self, host: &str, token: &str) -> AppResult<()> {
        entry(host)
            .and_then(|e| e.set_password(token))
            .map_err(store_error)
    }

    fn clear(&self, host: &str) -> AppResult<()> {
        match entry(host).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(store_error(e)),
        }
    }
}

#[cfg(embedded_git)]
fn file_store() -> AppResult<&'static crate::secrets::FileStore> {
    crate::secrets::global()
        .ok_or_else(|| AppError::new(ErrorKind::Internal, "secret store not initialised"))
}

#[cfg(embedded_git)]
impl ForgeTokens for SystemTokens {
    fn get(&self, host: &str) -> Option<String> {
        crate::secrets::global()?.get(KEYCHAIN_SERVICE, host)
    }

    fn set(&self, host: &str, token: &str) -> AppResult<()> {
        file_store()?.set(KEYCHAIN_SERVICE, host, token)
    }

    fn clear(&self, host: &str) -> AppResult<()> {
        file_store()?.delete(KEYCHAIN_SERVICE, host)
    }
}

/// The remembered HTTPS credential secret of `host`, if any.
fn git_credential(git: &dyn SecretStore, host: &str) -> Option<String> {
    let user = git.get(host, "")?;
    git.get(host, &user).filter(|s| !s.is_empty())
}

/// Forge token first, then the remembered git credential, else none.
pub fn resolve(
    tokens: &dyn ForgeTokens,
    git: &dyn SecretStore,
    host: &str,
) -> (Option<String>, ForgeTokenSource) {
    if let Some(t) = tokens.get(host).filter(|t| !t.is_empty()) {
        return (Some(t), ForgeTokenSource::Forge);
    }
    if let Some(t) = git_credential(git, host) {
        return (Some(t), ForgeTokenSource::GitCredential);
    }
    (None, ForgeTokenSource::None)
}

/// Trimmed token, or `InvalidInput` when empty or containing whitespace.
pub fn clean_token(token: &str) -> AppResult<String> {
    let t = token.trim();
    if t.is_empty() || t.chars().any(char::is_whitespace) {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            "A token cannot be empty or contain spaces",
        ));
    }
    Ok(t.to_string())
}
