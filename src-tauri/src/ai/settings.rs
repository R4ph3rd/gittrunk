//! AI settings (`ai.json` in the app config dir) and API-key storage (OS
//! keychain only). Keys are never written to `ai.json` and never returned.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::{AiProviderKind, AiSettings};

#[cfg(any(not(embedded_git), test))]
use super::provider::provider_name;

pub const KEYCHAIN_SERVICE: &str = "gittrunk-ai";
pub const FILE_NAME: &str = "ai.json";

/// Default model: Claude Haiku 4.5. Commit messages, summaries and PR drafts
/// are short generations where latency and cost dominate; Haiku 4.5 is the
/// cheapest current Claude model ($1 / $5 per MTok), accepts no thinking
/// parameters (so requests stay minimal) and its 200K context far exceeds the
/// default 60 KB diff cap. Users can pick a larger model in settings.
pub const DEFAULT_MODEL: &str = "claude-haiku-4-5";
pub const DEFAULT_MAX_DIFF_BYTES: u32 = 60_000;
pub const MIN_MAX_DIFF_BYTES: u32 = 1_000;
pub const MAX_MAX_DIFF_BYTES: u32 = 1_000_000;

/// Secret storage for provider keys.
pub trait KeyStore: Send + Sync {
    fn get(&self, provider: AiProviderKind) -> Option<String>;
    fn set(&self, provider: AiProviderKind, key: &str) -> AppResult<()>;
    /// Clearing a missing key is not an error.
    fn clear(&self, provider: AiProviderKind) -> AppResult<()>;
}

/// The OS keychain (service `gittrunk-ai`, account = provider name).
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemKeys;

#[cfg(not(embedded_git))]
fn entry(provider: AiProviderKind) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(KEYCHAIN_SERVICE, provider_name(provider))
}

#[cfg(not(embedded_git))]
fn store_error(e: keyring::Error) -> AppError {
    AppError::new(ErrorKind::Internal, format!("keychain: {e}"))
}

#[cfg(not(embedded_git))]
impl KeyStore for SystemKeys {
    fn get(&self, provider: AiProviderKind) -> Option<String> {
        entry(provider).ok()?.get_password().ok()
    }

    fn set(&self, provider: AiProviderKind, key: &str) -> AppResult<()> {
        entry(provider)
            .and_then(|e| e.set_password(key))
            .map_err(store_error)
    }

    fn clear(&self, provider: AiProviderKind) -> AppResult<()> {
        match entry(provider).and_then(|e| e.delete_credential()) {
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
impl KeyStore for SystemKeys {
    fn get(&self, provider: AiProviderKind) -> Option<String> {
        KeyStore::get(crate::secrets::global()?, provider)
    }

    fn set(&self, provider: AiProviderKind, key: &str) -> AppResult<()> {
        KeyStore::set(file_store()?, provider, key)
    }

    fn clear(&self, provider: AiProviderKind) -> AppResult<()> {
        KeyStore::clear(file_store()?, provider)
    }
}

/// What is persisted in `ai.json` (no `has_key`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    enabled: bool,
    provider: AiProviderKind,
    model: String,
    base_url: Option<String>,
    max_diff_bytes: u32,
}

impl Default for Stored {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: AiProviderKind::Anthropic,
            model: DEFAULT_MODEL.to_string(),
            base_url: None,
            max_diff_bytes: DEFAULT_MAX_DIFF_BYTES,
        }
    }
}

impl Stored {
    fn into_settings(self, keys: &dyn KeyStore) -> AiSettings {
        let has_key = keys.get(self.provider).is_some();
        AiSettings {
            enabled: self.enabled,
            provider: self.provider,
            model: self.model,
            base_url: self.base_url,
            max_diff_bytes: self.max_diff_bytes,
            has_key,
        }
    }
}

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// Loads settings; a missing or unreadable file yields the defaults (AI off).
pub fn load(dir: &Path, keys: &dyn KeyStore) -> AiSettings {
    let stored = fs::read_to_string(path(dir))
        .ok()
        .and_then(|s| serde_json::from_str::<Stored>(&s).ok())
        .unwrap_or_default();
    stored.into_settings(keys)
}

/// Validates, persists and returns the settings (with `has_key` recomputed).
pub fn save(dir: &Path, keys: &dyn KeyStore, settings: &AiSettings) -> AppResult<AiSettings> {
    let model = settings.model.trim().to_string();
    if model.is_empty() {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            "model must not be empty",
        ));
    }
    if !(MIN_MAX_DIFF_BYTES..=MAX_MAX_DIFF_BYTES).contains(&settings.max_diff_bytes) {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            format!(
                "max diff size must be between {MIN_MAX_DIFF_BYTES} and {MAX_MAX_DIFF_BYTES} bytes"
            ),
        ));
    }
    let base_url = settings
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .map(str::to_string);
    if let Some(url) = &base_url {
        match reqwest::Url::parse(url) {
            Ok(u) if matches!(u.scheme(), "http" | "https") && u.host_str().is_some() => {}
            _ => {
                return Err(AppError::new(
                    ErrorKind::InvalidInput,
                    "base URL must be an http(s) URL",
                ))
            }
        }
    }
    let stored = Stored {
        enabled: settings.enabled,
        provider: settings.provider,
        model,
        base_url,
        max_diff_bytes: settings.max_diff_bytes,
    };
    fs::create_dir_all(dir)?;
    let json = serde_json::to_string_pretty(&stored)
        .map_err(|e| AppError::new(ErrorKind::Internal, e.to_string()))?;
    fs::write(path(dir), json)?;
    Ok(stored.into_settings(keys))
}

/// Stores a key. Empty keys are rejected; the key is never echoed back.
pub fn set_key(keys: &dyn KeyStore, provider: AiProviderKind, key: &str) -> AppResult<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            "the API key is empty",
        ));
    }
    keys.set(provider, key)
}

#[cfg(test)]
pub mod testing {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    pub struct MemKeys(pub Mutex<HashMap<&'static str, String>>);

    impl KeyStore for MemKeys {
        fn get(&self, p: AiProviderKind) -> Option<String> {
            self.0.lock().unwrap().get(provider_name(p)).cloned()
        }
        fn set(&self, p: AiProviderKind, key: &str) -> AppResult<()> {
            self.0
                .lock()
                .unwrap()
                .insert(provider_name(p), key.to_string());
            Ok(())
        }
        fn clear(&self, p: AiProviderKind) -> AppResult<()> {
            self.0.lock().unwrap().remove(provider_name(p));
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::MemKeys;
    use super::*;

    #[test]
    fn defaults_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let s = load(dir.path(), &MemKeys::default());
        assert!(!s.enabled);
        assert_eq!(s.provider, AiProviderKind::Anthropic);
        assert_eq!(s.model, DEFAULT_MODEL);
        assert_eq!(s.base_url, None);
        assert_eq!(s.max_diff_bytes, 60_000);
        assert!(!s.has_key);
    }

    #[test]
    fn round_trip_and_has_key_from_keychain_only() {
        let dir = tempfile::tempdir().unwrap();
        let keys = MemKeys::default();
        let mut s = load(dir.path(), &keys);
        s.enabled = true;
        s.model = " some-model ".into();
        s.has_key = true; // ignored: computed from the keychain
        let saved = save(dir.path(), &keys, &s).unwrap();
        assert_eq!(saved.model, "some-model");
        assert!(!saved.has_key);
        set_key(&keys, AiProviderKind::Anthropic, "sk-secret").unwrap();
        let loaded = load(dir.path(), &keys);
        assert!(loaded.enabled && loaded.has_key);
        let raw = fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(!raw.contains("sk-secret") && !raw.contains("hasKey"));
        keys.clear(AiProviderKind::Anthropic).unwrap();
        assert!(!load(dir.path(), &keys).has_key);
    }

    #[test]
    fn rejects_bad_input() {
        let dir = tempfile::tempdir().unwrap();
        let keys = MemKeys::default();
        let ok = load(dir.path(), &keys);
        let mut bad = ok.clone();
        bad.max_diff_bytes = 10;
        assert_eq!(
            save(dir.path(), &keys, &bad).unwrap_err().kind,
            ErrorKind::InvalidInput
        );
        let mut bad = ok.clone();
        bad.base_url = Some("ftp://x".into());
        assert_eq!(
            save(dir.path(), &keys, &bad).unwrap_err().kind,
            ErrorKind::InvalidInput
        );
        assert_eq!(
            set_key(&keys, AiProviderKind::Anthropic, "  ")
                .unwrap_err()
                .kind,
            ErrorKind::InvalidInput
        );
    }
}

#[cfg(all(test, embedded_git))]
mod embedded_tests {
    use super::*;

    #[test]
    fn system_keys_persist_through_file_store() {
        crate::secrets::test_init();
        SystemKeys
            .set(AiProviderKind::OpenAiCompatible, "sk-x")
            .unwrap();
        assert_eq!(
            SystemKeys.get(AiProviderKind::OpenAiCompatible).as_deref(),
            Some("sk-x")
        );
        SystemKeys.clear(AiProviderKind::OpenAiCompatible).unwrap();
        assert_eq!(SystemKeys.get(AiProviderKind::OpenAiCompatible), None);
    }
}
