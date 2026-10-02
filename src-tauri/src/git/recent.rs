//! Persisted list of recently opened repositories. Storage takes a directory
//! so it is testable without Tauri.

use std::fs;
use std::path::{Path, PathBuf};

use parking_lot::Mutex;

use crate::ipc::error::AppResult;
use crate::ipc::types::{KnownRepo, RecentRepo};

pub const MAX_RECENT: usize = 20;
const FILE_NAME: &str = "recent-repos.json";
/// Cap of the "all known repositories" list.
pub const MAX_KNOWN: usize = 500;
const KNOWN_FILE_NAME: &str = "known-repos.json";

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

    fn known_file(&self) -> PathBuf {
        self.dir.join(KNOWN_FILE_NAME)
    }

    /// Most recent first. A missing or corrupt file reads as empty.
    pub fn load(&self) -> Vec<RecentRepo> {
        read_list(&self.file()).unwrap_or_default()
    }

    fn load_known_raw(&self) -> Option<Vec<RecentRepo>> {
        read_list(&self.known_file())
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

        let mut known = self.load_known_raw().unwrap_or_default();
        merge_missing(&mut known, &list);
        match known.iter_mut().find(|r| r.path == path) {
            Some(entry) => {
                entry.name = name.to_string();
                entry.last_opened = now;
            }
            None => known.push(RecentRepo {
                path: path.to_string(),
                name: name.to_string(),
                last_opened: now,
            }),
        }
        trim_known(&mut known);
        self.save_known(&known)?;
        Ok(list)
    }

    /// Every repository ever opened (up to `MAX_KNOWN`), sorted by name.
    /// Seeds the file from the recent list on first use.
    pub fn known(&self) -> Vec<KnownRepo> {
        let _guard = WRITE_LOCK.lock();
        let existing = self.load_known_raw();
        let had_file = existing.is_some();
        let mut list = existing.unwrap_or_default();
        let before = list.len();
        merge_missing(&mut list, &self.load());
        trim_known(&mut list);
        if !had_file || list.len() != before {
            let _ = self.save_known(&list);
        }
        let mut out: Vec<KnownRepo> = list
            .into_iter()
            .map(|r| KnownRepo {
                exists: Path::new(&r.path).exists(),
                path: r.path,
                name: r.name,
                last_opened: r.last_opened,
            })
            .collect();
        out.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then_with(|| a.path.cmp(&b.path))
        });
        out
    }

    /// Removes the exact `path` from both lists. Never touches the folder.
    pub fn forget(&self, path: &str) -> AppResult<()> {
        let _guard = WRITE_LOCK.lock();
        let mut recent = self.load();
        let before = recent.len();
        recent.retain(|r| r.path != path);
        if recent.len() != before {
            self.save(&recent)?;
        }
        if let Some(mut known) = self.load_known_raw() {
            let before = known.len();
            known.retain(|r| r.path != path);
            if known.len() != before {
                self.save_known(&known)?;
            }
        }
        Ok(())
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
        if let Some(mut known) = self.load_known_raw() {
            let before = known.len();
            known.retain(|r| !Path::new(&r.path).starts_with(path));
            if known.len() != before {
                self.save_known(&known)?;
            }
        }
        Ok(())
    }

    fn save(&self, list: &[RecentRepo]) -> AppResult<()> {
        self.write_json(FILE_NAME, list)
    }

    fn save_known(&self, list: &[RecentRepo]) -> AppResult<()> {
        self.write_json(KNOWN_FILE_NAME, list)
    }

    fn write_json(&self, name: &str, list: &[RecentRepo]) -> AppResult<()> {
        fs::create_dir_all(&self.dir)?;
        let text = serde_json::to_string_pretty(list).map_err(|e| {
            crate::ipc::error::AppError::new(crate::ipc::error::ErrorKind::Internal, e.to_string())
        })?;
        let tmp = self.dir.join(format!("{name}.tmp"));
        fs::write(&tmp, text)?;
        fs::rename(&tmp, self.dir.join(name))?;
        Ok(())
    }
}

/// `None` when the file is missing or corrupt.
fn read_list(file: &Path) -> Option<Vec<RecentRepo>> {
    let text = fs::read_to_string(file).ok()?;
    serde_json::from_str(&text).ok()
}

fn merge_missing(known: &mut Vec<RecentRepo>, recent: &[RecentRepo]) {
    for r in recent {
        if !known.iter().any(|k| k.path == r.path) {
            known.push(r.clone());
        }
    }
}

/// Keeps the `MAX_KNOWN` most recently opened entries.
fn trim_known(known: &mut Vec<RecentRepo>) {
    if known.len() > MAX_KNOWN {
        known.sort_by(|a, b| b.last_opened.total_cmp(&a.last_opened));
        known.truncate(MAX_KNOWN);
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
    fn known_seeds_from_recent() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(FILE_NAME),
            r#"[{"path":"/a","name":"a","lastOpened":1.0}]"#,
        )
        .unwrap();
        let store = RecentStore::new(dir.path());
        let known = store.known();
        assert_eq!(known.len(), 1);
        assert_eq!(known[0].path, "/a");
        assert!(dir.path().join(KNOWN_FILE_NAME).exists());
    }

    #[test]
    fn known_merges_missing_recent_entries() {
        let dir = tempfile::tempdir().unwrap();
        let store = RecentStore::new(dir.path());
        store.record("/a", "a", 1.0).unwrap();
        fs::write(
            dir.path().join(FILE_NAME),
            r#"[{"path":"/b","name":"b","lastOpened":2.0},{"path":"/a","name":"a","lastOpened":1.0}]"#,
        )
        .unwrap();
        let paths: Vec<_> = store.known().into_iter().map(|k| k.path).collect();
        assert_eq!(paths, ["/a", "/b"]);
    }

    #[test]
    fn record_keeps_known_beyond_twenty() {
        let dir = tempfile::tempdir().unwrap();
        let store = RecentStore::new(dir.path());
        for i in 0..30 {
            store.record(&format!("/r{i}"), "r", f64::from(i)).unwrap();
        }
        assert_eq!(store.load().len(), MAX_RECENT);
        assert_eq!(store.known().len(), 30);
        store.record("/r0", "renamed", 100.0).unwrap();
        let known = store.known();
        assert_eq!(known.len(), 30);
        let r0 = known.iter().find(|k| k.path == "/r0").unwrap();
        assert_eq!((r0.name.as_str(), r0.last_opened), ("renamed", 100.0));
    }

    #[test]
    fn known_caps_at_max_dropping_oldest() {
        let dir = tempfile::tempdir().unwrap();
        let store = RecentStore::new(dir.path());
        let seed: Vec<RecentRepo> = (0..MAX_KNOWN)
            .map(|i| RecentRepo {
                path: format!("/r{i}"),
                name: format!("r{i}"),
                last_opened: i as f64 + 10.0,
            })
            .collect();
        store.save_known(&seed).unwrap();
        store.record("/new", "new", 1000.0).unwrap();
        let known = store.known();
        assert_eq!(known.len(), MAX_KNOWN);
        assert!(known.iter().any(|k| k.path == "/new"));
        assert!(!known.iter().any(|k| k.path == "/r0"));
        assert!(known.iter().any(|k| k.path == "/r1"));
    }

    #[test]
    fn forget_removes_from_both_lists_only() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("repo");
        fs::create_dir(&folder).unwrap();
        let p = folder.to_string_lossy().into_owned();
        let store = RecentStore::new(dir.path());
        store.record(&p, "repo", 1.0).unwrap();
        store.record("/other", "other", 2.0).unwrap();
        store.forget(&p).unwrap();
        store.forget("/unknown").unwrap();
        assert!(store.load().iter().all(|r| r.path != p));
        assert!(store.known().iter().all(|r| r.path != p));
        assert_eq!(store.known().len(), 1);
        assert!(folder.exists());
    }

    #[test]
    fn remove_path_prunes_known() {
        let dir = tempfile::tempdir().unwrap();
        let store = RecentStore::new(dir.path());
        store.record("/keep", "keep", 1.0).unwrap();
        store.record("/gone", "gone", 2.0).unwrap();
        store.remove_path(Path::new("/gone")).unwrap();
        let paths: Vec<_> = store.known().into_iter().map(|k| k.path).collect();
        assert_eq!(paths, ["/keep"]);
    }

    #[test]
    fn known_exists_flag_and_sort_order() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("Real");
        fs::create_dir(&real).unwrap();
        let real_path = real.to_string_lossy().into_owned();
        let store = RecentStore::new(dir.path().join("data"));
        store.record("/zeta/missing", "zeta", 1.0).unwrap();
        store.record(&real_path, "Beta", 2.0).unwrap();
        store.record("/b/alpha", "alpha", 3.0).unwrap();
        store.record("/a/alpha", "Alpha", 4.0).unwrap();
        let known = store.known();
        let order: Vec<_> = known.iter().map(|k| k.path.as_str()).collect();
        assert_eq!(
            order,
            ["/a/alpha", "/b/alpha", real_path.as_str(), "/zeta/missing"]
        );
        assert!(known[2].exists);
        assert!(!known[3].exists);
    }

    #[test]
    fn corrupt_known_file_reads_empty_then_reseeds() {
        let dir = tempfile::tempdir().unwrap();
        let store = RecentStore::new(dir.path());
        store.record("/a", "a", 1.0).unwrap();
        fs::write(dir.path().join(KNOWN_FILE_NAME), "not json").unwrap();
        let known = store.known();
        assert_eq!(known.len(), 1);
        assert_eq!(known[0].path, "/a");
        assert_eq!(store.record("/b", "b", 2.0).unwrap().len(), 2);
        assert_eq!(store.known().len(), 2);
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
