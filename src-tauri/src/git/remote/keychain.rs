//! OS keychain storage for remembered credentials (service `gittrunk`,
//! account `<host>|<username>`). The entry `<host>|` holds the last
//! remembered username of a host, so a username prompt can be answered and
//! `credential_clear(host)` can find what to delete.

use crate::ipc::error::{AppError, AppResult, ErrorKind};

pub const SERVICE: &str = "gittrunk";

pub fn account(host: &str, username: &str) -> String {
    format!("{host}|{username}")
}

/// Secret storage abstraction (the bridge is tested with an in-memory fake).
pub trait SecretStore: Send + Sync {
    fn get(&self, host: &str, username: &str) -> Option<String>;
    fn set(&self, host: &str, username: &str, secret: &str) -> AppResult<()>;
    /// Deleting a missing entry is not an error.
    fn delete(&self, host: &str, username: &str) -> AppResult<()>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Keychain;

fn entry(host: &str, username: &str) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, &account(host, username))
}

fn store_error(e: keyring::Error) -> AppError {
    AppError::new(ErrorKind::Internal, format!("keychain: {e}"))
}

impl Keychain {
    /// Whether a secret service / keychain is reachable (false on headless CI).
    pub fn available() -> bool {
        match entry("gittrunk-probe", "probe").and_then(|e| e.get_password()) {
            Ok(_) | Err(keyring::Error::NoEntry) => true,
            Err(_) => false,
        }
    }
}

impl SecretStore for Keychain {
    fn get(&self, host: &str, username: &str) -> Option<String> {
        entry(host, username).ok()?.get_password().ok()
    }

    fn set(&self, host: &str, username: &str, secret: &str) -> AppResult<()> {
        entry(host, username)
            .and_then(|e| e.set_password(secret))
            .map_err(store_error)
    }

    fn delete(&self, host: &str, username: &str) -> AppResult<()> {
        match entry(host, username).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(store_error(e)),
        }
    }
}

/// Stores `secret` for `host`/`username` and remembers the username.
pub fn store(secrets: &dyn SecretStore, host: &str, username: &str, secret: &str) -> AppResult<()> {
    secrets.set(host, username, secret)?;
    secrets.set(host, "", username)
}

/// Removes everything remembered for `host`.
pub fn clear(secrets: &dyn SecretStore, host: &str) -> AppResult<()> {
    if let Some(user) = secrets.get(host, "") {
        secrets.delete(host, &user)?;
    }
    secrets.delete(host, "")
}
