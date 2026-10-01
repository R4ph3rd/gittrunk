//! On-disk avatar cache: `<dir>/<sha256(key|size)>` holding the data URL text,
//! or an empty file for a cached miss. Freshness comes from the file mtime.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use sha2::{Digest, Sha256};

const HIT_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
const MISS_TTL: Duration = Duration::from_secs(24 * 3600);

pub(super) fn path(dir: &Path, key: &str, size: u32) -> PathBuf {
    let digest = Sha256::digest(format!("{key}|{size}").as_bytes());
    dir.join(hex(&digest))
}

pub(super) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Hits stay fresh for 7 days, misses for 1 day.
pub(super) fn fresh(stored: SystemTime, now: SystemTime, miss: bool) -> bool {
    let ttl = if miss { MISS_TTL } else { HIT_TTL };
    now.duration_since(stored).map_or(true, |age| age < ttl)
}

/// `Some(Some(data_url))` hit, `Some(None)` cached miss, `None` absent, stale
/// or unreadable.
pub(super) fn read_disk(path: &Path, now: SystemTime) -> Option<Option<String>> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    let text = fs::read_to_string(path).ok()?;
    let value = (!text.is_empty()).then_some(text);
    fresh(modified, now, value.is_none()).then_some(value)
}

/// Best effort: a failing cache directory degrades to memory-only.
pub(super) fn write_disk(path: &Path, value: Option<&str>) {
    let _ = fs::write(path, value.unwrap_or(""));
}
