//! Avatar fetching and caching: backend-fetched images returned as `data:` URLs.
//!
//! Nothing here logs emails, hashes or URLs.

mod cache;
mod sources;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::SystemTime;

use base64::Engine;
use parking_lot::Mutex;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::ipc::types::{AvatarMode, AvatarSubject};

pub use sources::Sources;

/// Most subjects accepted by one `avatars_get` call.
pub const MAX_SUBJECTS: usize = 200;
const MIN_SIZE: u32 = 16;
const MAX_SIZE: u32 = 256;
const MAX_BODY: usize = 256 * 1024;
const MAX_IN_FLIGHT: usize = 6;

/// Outcome of one network fetch.
enum Fetched {
    /// A `data:` URL.
    Image(String),
    /// Definitive absence (4xx or not an acceptable image): cached for a day.
    Miss,
    /// Network error, timeout or 5xx: not cached.
    Failed,
}

#[derive(Clone)]
struct MemEntry {
    value: Option<String>,
    stored: SystemTime,
}

/// In-memory and on-disk avatar cache.
#[derive(Default)]
pub struct AvatarCache {
    mem: Mutex<HashMap<(String, u32), MemEntry>>,
}

impl AvatarCache {
    /// Resolves every subject to a `data:` URL or `None`, same length and order
    /// as `subjects`. `dir` is the on-disk cache directory (`None`: memory only).
    pub async fn get_many(
        &self,
        http: &reqwest::Client,
        dir: Option<&Path>,
        mode: AvatarMode,
        sources: &Sources,
        subjects: &[AvatarSubject],
        size: u32,
    ) -> Vec<Option<String>> {
        if mode == AvatarMode::Off {
            return vec![None; subjects.len()];
        }
        let size = size.clamp(MIN_SIZE, MAX_SIZE);
        let now = SystemTime::now();
        let dir = dir.filter(|d| std::fs::create_dir_all(d).is_ok());

        // One lookup per distinct key; `slots[i]` indexes into `keys`.
        let mut keys: Vec<(String, String)> = Vec::new(); // (key, url)
        let mut index: HashMap<String, usize> = HashMap::new();
        let slots: Vec<Option<usize>> = subjects
            .iter()
            .map(|s| {
                let (key, url) = sources::resolve(sources, mode, s, size)?;
                Some(*index.entry(key.clone()).or_insert_with(|| {
                    keys.push((key, url));
                    keys.len() - 1
                }))
            })
            .collect();

        let mut results: Vec<Option<String>> = vec![None; keys.len()];
        let mut to_fetch: Vec<usize> = Vec::new();
        for (i, (key, _)) in keys.iter().enumerate() {
            match self.lookup(dir, key, size, now) {
                Some(v) => results[i] = v,
                None => to_fetch.push(i),
            }
        }

        let gate = Arc::new(Semaphore::new(MAX_IN_FLIGHT));
        let mut set = JoinSet::new();
        for i in to_fetch {
            let (http, gate, url) = (http.clone(), gate.clone(), keys[i].1.clone());
            set.spawn(async move {
                let _permit = gate.acquire_owned().await.ok();
                (i, fetch(&http, &url).await)
            });
        }
        while let Some(joined) = set.join_next().await {
            let Ok((i, fetched)) = joined else { continue };
            let value = match fetched {
                Fetched::Image(url) => Some(url),
                Fetched::Miss => None,
                Fetched::Failed => continue,
            };
            self.store(dir, &keys[i].0, size, value.clone(), now);
            results[i] = value;
        }

        slots
            .into_iter()
            .map(|s| s.and_then(|i| results[i].clone()))
            .collect()
    }

    /// `Some(value)` for a fresh cached answer (`None` inside = cached miss).
    fn lookup(
        &self,
        dir: Option<&Path>,
        key: &str,
        size: u32,
        now: SystemTime,
    ) -> Option<Option<String>> {
        let mem_key = (key.to_string(), size);
        let mem = self.mem.lock().get(&mem_key).cloned();
        if let Some(e) = mem {
            if cache::fresh(e.stored, now, e.value.is_none()) {
                return Some(e.value);
            }
        }
        let found = cache::read_disk(&cache::path(dir?, key, size), now)?;
        self.mem.lock().insert(
            mem_key,
            MemEntry {
                value: found.clone(),
                stored: now,
            },
        );
        Some(found)
    }

    fn store(
        &self,
        dir: Option<&Path>,
        key: &str,
        size: u32,
        value: Option<String>,
        now: SystemTime,
    ) {
        if let Some(dir) = dir {
            cache::write_disk(&cache::path(dir, key, size), value.as_deref());
        }
        self.mem
            .lock()
            .insert((key.to_string(), size), MemEntry { value, stored: now });
    }
}

async fn fetch(http: &reqwest::Client, url: &str) -> Fetched {
    let Ok(mut resp) = http.get(url).send().await else {
        return Fetched::Failed;
    };
    let status = resp.status();
    if status.is_server_error() {
        return Fetched::Failed;
    }
    if status.as_u16() != 200 {
        return Fetched::Miss;
    }
    let Some(content_type) = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| {
            v.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
    else {
        return Fetched::Miss;
    };
    let valid_type = content_type.starts_with("image/")
        && content_type
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'+' | b'.' | b'-'));
    if !valid_type || resp.content_length().is_some_and(|l| l > MAX_BODY as u64) {
        return Fetched::Miss;
    }
    let mut body: Vec<u8> = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() + chunk.len() > MAX_BODY {
                    return Fetched::Miss;
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => return Fetched::Failed,
        }
    }
    if body.is_empty() {
        return Fetched::Miss;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&body);
    Fetched::Image(format!("data:{content_type};base64,{b64}"))
}
