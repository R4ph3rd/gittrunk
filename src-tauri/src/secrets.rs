//! File-backed secret store for embedded (Android) builds, where no OS
//! keychain is available. The app data dir is private to the app; the file is
//! additionally `0600` on unix. Secrets are never logged or echoed.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use crate::ai::provider::provider_name;
use crate::ai::settings::{KeyStore, KEYCHAIN_SERVICE};
use crate::git::remote::keychain::{self, SecretStore};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::AiProviderKind;
use crate::settings::atomic_write_mode;

pub const FILE_NAME: &str = "secrets.json";

/// JSON object `{ "<service>:<account>": "<secret>" }`.
pub struct FileStore {
    path: PathBuf,
    lock: Mutex<()>,
}

fn key(service: &str, account: &str) -> String {
    format!("{service}:{account}")
}

impl FileStore {
    /// The file need not exist yet.
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    fn guard(&self) -> MutexGuard<'_, ()> {
        self.lock.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// A missing or corrupt file reads as empty (the next write repairs it).
    fn read(&self) -> BTreeMap<String, String> {
        fs::read_to_string(&self.path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    fn write(&self, map: &BTreeMap<String, String>) -> AppResult<()> {
        let json = serde_json::to_vec_pretty(map)
            .map_err(|e| AppError::new(ErrorKind::Internal, e.to_string()))?;
        atomic_write_mode(&self.path, &json, Some(0o600))
    }

    pub fn get(&self, service: &str, account: &str) -> Option<String> {
        let _g = self.guard();
        self.read().remove(&key(service, account))
    }

    pub fn set(&self, service: &str, account: &str, secret: &str) -> AppResult<()> {
        let _g = self.guard();
        let mut map = self.read();
        map.insert(key(service, account), secret.to_string());
        self.write(&map)
    }

    /// Deleting a missing entry is not an error.
    pub fn delete(&self, service: &str, account: &str) -> AppResult<()> {
        let _g = self.guard();
        let mut map = self.read();
        if map.remove(&key(service, account)).is_some() {
            self.write(&map)?;
        }
        Ok(())
    }
}

impl SecretStore for FileStore {
    fn get(&self, host: &str, username: &str) -> Option<String> {
        FileStore::get(self, keychain::SERVICE, &keychain::account(host, username))
    }

    fn set(&self, host: &str, username: &str, secret: &str) -> AppResult<()> {
        FileStore::set(
            self,
            keychain::SERVICE,
            &keychain::account(host, username),
            secret,
        )
    }

    fn delete(&self, host: &str, username: &str) -> AppResult<()> {
        FileStore::delete(self, keychain::SERVICE, &keychain::account(host, username))
    }
}

impl KeyStore for FileStore {
    fn get(&self, provider: AiProviderKind) -> Option<String> {
        FileStore::get(self, KEYCHAIN_SERVICE, provider_name(provider))
    }

    fn set(&self, provider: AiProviderKind, key: &str) -> AppResult<()> {
        FileStore::set(self, KEYCHAIN_SERVICE, provider_name(provider), key)
    }

    fn clear(&self, provider: AiProviderKind) -> AppResult<()> {
        FileStore::delete(self, KEYCHAIN_SERVICE, provider_name(provider))
    }
}

static GLOBAL: OnceLock<FileStore> = OnceLock::new();

/// Creates the global store at `<dir>/secrets.json`. Idempotent: the first
/// call wins.
pub fn init(dir: &Path) -> AppResult<()> {
    fs::create_dir_all(dir)?;
    let _ = GLOBAL.get_or_init(|| FileStore::new(dir.join(FILE_NAME)));
    Ok(())
}

pub fn global() -> Option<&'static FileStore> {
    GLOBAL.get()
}

/// Initialises the global store once in a directory that lives for the whole
/// test process (tests share the global).
#[cfg(test)]
pub(crate) fn test_init() {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    let dir = DIR.get_or_init(|| tempfile::tempdir().expect("tempdir").keep());
    init(dir).expect("init");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn store() -> (tempfile::TempDir, FileStore) {
        let dir = tempfile::tempdir().unwrap();
        let s = FileStore::new(dir.path().join("nested").join(FILE_NAME));
        (dir, s)
    }

    #[test]
    fn round_trip_overwrite_delete() {
        let (_d, s) = store();
        assert_eq!(s.get("svc", "a"), None);
        s.set("svc", "a", "one").unwrap();
        assert_eq!(s.get("svc", "a").as_deref(), Some("one"));
        s.set("svc", "a", "two").unwrap();
        assert_eq!(s.get("svc", "a").as_deref(), Some("two"));
        s.delete("svc", "a").unwrap();
        assert_eq!(s.get("svc", "a"), None);
        s.delete("svc", "a").unwrap();
        s.delete("never", "existed").unwrap();
    }

    #[test]
    fn services_do_not_collide_and_persist() {
        let (_d, s) = store();
        s.set("one", "acct", "x").unwrap();
        s.set("two", "acct", "y").unwrap();
        assert_eq!(s.get("one", "acct").as_deref(), Some("x"));
        assert_eq!(s.get("two", "acct").as_deref(), Some("y"));
        let again = FileStore::new(s.path.clone());
        assert_eq!(again.get("two", "acct").as_deref(), Some("y"));
    }

    #[cfg(unix)]
    #[test]
    fn file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let (_d, s) = store();
        s.set("svc", "a", "secret").unwrap();
        let mode = fs::metadata(&s.path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        s.set("svc", "b", "secret").unwrap();
        let mode = fs::metadata(&s.path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn write_leaves_no_temp_file() {
        let (_d, s) = store();
        s.set("svc", "a", "x").unwrap();
        s.delete("svc", "a").unwrap();
        let names: Vec<_> = fs::read_dir(s.path.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![FILE_NAME.to_string()]);
    }

    #[test]
    fn corrupt_file_reads_empty_and_is_repaired() {
        let (_d, s) = store();
        fs::create_dir_all(s.path.parent().unwrap()).unwrap();
        fs::write(&s.path, "{ not json").unwrap();
        assert_eq!(s.get("svc", "a"), None);
        s.set("svc", "a", "ok").unwrap();
        assert_eq!(s.get("svc", "a").as_deref(), Some("ok"));
        let parsed: BTreeMap<String, String> =
            serde_json::from_str(&fs::read_to_string(&s.path).unwrap()).unwrap();
        assert_eq!(parsed.len(), 1);
    }

    #[test]
    fn concurrent_sets_both_persist() {
        let (_d, s) = store();
        let s = Arc::new(s);
        let handles: Vec<_> = ["a", "b"]
            .into_iter()
            .map(|k| {
                let s = Arc::clone(&s);
                std::thread::spawn(move || {
                    for i in 0..20 {
                        s.set("svc", k, &format!("v{i}")).unwrap();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(s.get("svc", "a").as_deref(), Some("v19"));
        assert_eq!(s.get("svc", "b").as_deref(), Some("v19"));
    }

    #[test]
    fn trait_impls_use_keyring_naming() {
        let (_d, s) = store();
        SecretStore::set(&s, "github.com", "me", "pw").unwrap();
        assert_eq!(
            s.get(keychain::SERVICE, "github.com|me").as_deref(),
            Some("pw")
        );
        assert_eq!(
            SecretStore::get(&s, "github.com", "me").as_deref(),
            Some("pw")
        );
        SecretStore::delete(&s, "github.com", "me").unwrap();
        assert_eq!(SecretStore::get(&s, "github.com", "me"), None);

        KeyStore::set(&s, AiProviderKind::Anthropic, "k").unwrap();
        assert_eq!(
            s.get(KEYCHAIN_SERVICE, provider_name(AiProviderKind::Anthropic))
                .as_deref(),
            Some("k")
        );
        KeyStore::clear(&s, AiProviderKind::Anthropic).unwrap();
        assert_eq!(KeyStore::get(&s, AiProviderKind::Anthropic), None);
    }

    #[test]
    fn init_is_idempotent() {
        test_init();
        let other = tempfile::tempdir().unwrap();
        init(other.path()).unwrap();
        assert!(global().is_some());
        assert!(!global().unwrap().path.starts_with(other.path()));
    }
}
