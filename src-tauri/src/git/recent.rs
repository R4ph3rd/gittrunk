//! Persisted list of recently opened repositories. Storage takes a directory
//! so it is testable without Tauri.

use std::fs;
use std::path::{Path, PathBuf};

use parking_lot::Mutex;

use crate::ipc::error::AppResult;
use crate::ipc::types::RecentRepo;

pub const MAX_RECENT: usize = 20;
const FILE_NAME: &str = "recent-repos.json";

static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub struct RecentStore {
    dir: PathBuf,
}

impl RecentStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn file(&self) -> PathBuf {
        self.dir.join(FILE_NAME)
    }

    /// Most recent first. A missing or corrupt file reads as empty.
    pub fn load(&self) -> Vec<RecentRepo> {
        let Ok(text) = fs::read_to_string(self.file()) else {
            return Vec::new();
        };
        serde_json::from_str(&text).unwrap_or_default()
    }

    /// Moves (or adds) `path` to the front, trims to `MAX_RECENT` and persists.
    pub fn record(&self, path: &str, name: &str, now: f64) -> AppResult<Vec<RecentRepo>> {
        let _guard = WRITE_LOCK.lock();
        let mut list = self.load();
        list.retain(|r| r.path != path);
        list.insert(
            0,
            RecentRepo {
                path: path.to_string(),
                name: name.to_string(),
                last_opened: now,
            },
        );
        list.truncate(MAX_RECENT);
        self.save(&list)?;
        Ok(list)
    }

    /// Drops every entry at or under `path` (used when a repository is deleted).
    pub fn remove_path(&self, path: &Path) -> AppResult<()> {
        let _guard = WRITE_LOCK.lock();
        let mut list = self.load();
        let before = list.len();
        list.retain(|r| !Path::new(&r.path).starts_with(path));
        if list.len() != before {
            self.save(&list)?;
        }
        Ok(())
    }

    fn save(&self, list: &[RecentRepo]) -> AppResult<()> {
        fs::create_dir_all(&self.dir)?;
        let text = serde_json::to_string_pretty(list).map_err(|e| {
            crate::ipc::error::AppError::new(crate::ipc::error::ErrorKind::Internal, e.to_string())
        })?;
        let tmp = self.dir.join(format!("{FILE_NAME}.tmp"));
        fs::write(&tmp, text)?;
        fs::rename(&tmp, self.file())?;
        Ok(())
    }
}

/// Seconds since the unix epoch.
pub fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

impl AsRef<Path> for RecentStore {
    fn as_ref(&self) -> &Path {
        &self.dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(RecentStore::new(dir.path()).load().is_empty());
    }

    #[test]
    fn persists_most_recent_first_and_dedupes() {
        let dir = tempfile::tempdir().unwrap();
        let store = RecentStore::new(dir.path().join("nested"));
        store.record("/a", "a", 1.0).unwrap();
        store.record("/b", "b", 2.0).unwrap();
        store.record("/a", "a", 3.0).unwrap();
        let fresh = RecentStore::new(dir.path().join("nested")).load();
        let paths: Vec<_> = fresh.iter().map(|r| r.path.as_str()).collect();
        assert_eq!(paths, ["/a", "/b"]);
        assert_eq!(fresh[0].last_opened, 3.0);
    }

    #[test]
    fn caps_at_twenty() {
        let dir = tempfile::tempdir().unwrap();
        let store = RecentStore::new(dir.path());
        for i in 0..30 {
            store.record(&format!("/r{i}"), "r", f64::from(i)).unwrap();
        }
        let list = store.load();
        assert_eq!(list.len(), MAX_RECENT);
        assert_eq!(list[0].path, "/r29");
        assert_eq!(list[19].path, "/r10");
    }

    #[test]
    fn remove_path_drops_matching_entries() {
        let dir = tempfile::tempdir().unwrap();
        let store = RecentStore::new(dir.path());
        store.record("/keep", "keep", 1.0).unwrap();
        store.record("/gone", "gone", 2.0).unwrap();
        store.remove_path(Path::new("/gone")).unwrap();
        let paths: Vec<_> = store.load().into_iter().map(|r| r.path).collect();
        assert_eq!(paths, ["/keep"]);
    }

    #[test]
    fn corrupt_file_reads_empty() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(FILE_NAME), "not json").unwrap();
        let store = RecentStore::new(dir.path());
        assert!(store.load().is_empty());
        assert_eq!(store.record("/x", "x", 1.0).unwrap().len(), 1);
    }
}
