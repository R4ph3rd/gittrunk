//! Persisted application settings and keybindings (app config dir).
//! Owned by `rust-git-agent`.
//!
//! State model: there is no in-memory settings state. Every command reads
//! `settings.json` / `keybindings.json` from the config directory (tiny
//! files), so "lazy loading" is just the first read; `settings_get` and
//! `settings_set` also apply `git_path` to `GitState`. The storage functions
//! take a directory and never touch Tauri, so they are unit-testable.

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

pub const SETTINGS_FILE: &str = "settings.json";
pub const KEYBINDINGS_FILE: &str = "keybindings.json";

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

pub fn defaults() -> AppSettings {
    AppSettings {
        theme: ThemePreference::System,
        git_path: None,
        pull_strategy: PullStrategy::Merge,
        confirm_destructive: true,
        graph_order: CommitOrder::Topo,
        diff_context_lines: 3,
        avatars: AvatarMode::Github,
    }
}

// ------------------------------------------------------------- storage

/// Writes `data` next to `path` and renames it into place.
pub fn atomic_write(path: &Path, data: &[u8]) -> AppResult<()> {
    atomic_write_mode(path, data, None)
}

/// Like [`atomic_write`]; `mode` (unix permission bits) is applied to the
/// temp file at creation, so the final file is never readable more widely.
/// Ignored on non-unix targets.
pub fn atomic_write_mode(path: &Path, data: &[u8], mode: Option<u32>) -> AppResult<()> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::new(ErrorKind::Io, "settings path has no parent"))?;
    fs::create_dir_all(dir)?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned());
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        name.unwrap_or_default(),
        std::process::id()
    ));
    let write = || -> std::io::Result<()> {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        if let Some(m) = mode {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(m);
        }
        #[cfg(not(unix))]
        let _ = mode;
        let mut f = opts.open(&tmp)?;
        #[cfg(unix)]
        if let Some(m) = mode {
            use std::os::unix::fs::PermissionsExt;
            f.set_permissions(fs::Permissions::from_mode(m))?;
        }
        f.write_all(data)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    };
    write().map_err(|e| {
        let _ = fs::remove_file(&tmp);
        AppError::from(e)
    })
}

/// Stored settings, missing fields filled from the defaults. A missing or
/// unreadable/corrupt file yields the defaults (the next save repairs it).
pub fn load(dir: &Path) -> AppSettings {
    let Ok(text) = fs::read_to_string(dir.join(SETTINGS_FILE)) else {
        return defaults();
    };
    let Ok(serde_json::Value::Object(stored)) = serde_json::from_str(&text) else {
        return defaults();
    };
    let Ok(serde_json::Value::Object(mut merged)) = serde_json::to_value(defaults()) else {
        return defaults();
    };
    for (k, v) in stored {
        merged.insert(k, v);
    }
    serde_json::from_value(serde_json::Value::Object(merged)).unwrap_or_else(|_| defaults())
}

/// Validates, normalises (blank `git_path` becomes `None`) and saves.
pub fn save(dir: &Path, settings: &AppSettings) -> AppResult<AppSettings> {
    let clean = validate(settings)?;
    let json = serde_json::to_vec_pretty(&clean)
        .map_err(|e| AppError::new(ErrorKind::Internal, e.to_string()))?;
    atomic_write(&dir.join(SETTINGS_FILE), &json)?;
    Ok(clean)
}

pub fn validate(settings: &AppSettings) -> AppResult<AppSettings> {
    let mut s = settings.clone();
    if s.diff_context_lines > 20 {
        return Err(invalid("diffContextLines must be between 0 and 20"));
    }
    // Without a git CLI the path is inert: stored as given, never executed.
    if crate::platform::EMBEDDED {
        return Ok(s);
    }
    s.git_path = match s.git_path.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(p) => {
            validate_git_path(p)?;
            Some(p.to_string())
        }
    };
    Ok(s)
}

/// Must point to an existing file that answers `--version` like git.
pub fn validate_git_path(path: &str) -> AppResult<()> {
    if path.contains('\0') {
        return Err(invalid("git path contains a NUL byte"));
    }
    let p = Path::new(path);
    if !p.is_file() {
        return Err(invalid(format!("`{path}` is not an existing file")));
    }
    let out = Command::new(p)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| invalid(format!("`{path}` cannot be executed: {e}")))?;
    let text = String::from_utf8_lossy(&out.stdout);
    if !out.status.success() || !text.starts_with("git version") {
        return Err(invalid(format!("`{path}` is not a working git executable")));
    }
    Ok(())
}

/// The git path to apply for `settings`, when it is still usable.
pub fn usable_git_path(settings: &AppSettings) -> Option<PathBuf> {
    if crate::platform::EMBEDDED {
        return None;
    }
    settings
        .git_path
        .as_deref()
        .filter(|p| validate_git_path(p).is_ok())
        .map(PathBuf::from)
}

// ---------------------------------------------------------- keybindings

const MODIFIERS: [&str; 7] = ["mod", "ctrl", "cmd", "meta", "alt", "option", "shift"];
const NAMED_KEYS: [&str; 16] = [
    "enter",
    "escape",
    "esc",
    "tab",
    "space",
    "backspace",
    "delete",
    "up",
    "down",
    "left",
    "right",
    "home",
    "end",
    "pageup",
    "pagedown",
    "plus",
];

fn valid_key(k: &str) -> bool {
    let mut chars = k.chars();
    let single = matches!((chars.next(), chars.next()), (Some(c), None)
        if !c.is_whitespace() && !c.is_control() && c != '+');
    single
        || NAMED_KEYS.contains(&k)
        || k.strip_prefix('f')
            .and_then(|n| n.parse::<u8>().ok())
            .is_some_and(|n| (1..=24).contains(&n))
}

/// Parses `mod+shift+k` (one chord) into a canonical form.
fn normalize_chord(chord: &str) -> AppResult<String> {
    let lower = chord.to_lowercase();
    let mut parts: Vec<&str> = lower.split('+').collect();
    let key = parts.pop().unwrap_or_default();
    if !valid_key(key) {
        return Err(invalid(format!("`{chord}` has no valid key")));
    }
    let mut mods: Vec<&str> = Vec::new();
    for m in parts {
        if !MODIFIERS.contains(&m) {
            return Err(invalid(format!("`{m}` is not a modifier in `{chord}`")));
        }
        if mods.contains(&m) {
            return Err(invalid(format!("duplicate modifier `{m}` in `{chord}`")));
        }
        mods.push(m);
    }
    mods.sort_unstable();
    mods.push(key);
    Ok(mods.join("+"))
}

/// One chord or a two-step sequence separated by a space; canonical form.
pub fn normalize_keys(keys: &str) -> AppResult<String> {
    let chords: Vec<&str> = keys.split(' ').collect();
    if chords.is_empty() || chords.len() > 2 || chords.iter().any(|c| c.is_empty()) {
        return Err(invalid(format!(
            "`{keys}` must be one chord or a two-step sequence"
        )));
    }
    let done: AppResult<Vec<String>> = chords.into_iter().map(normalize_chord).collect();
    Ok(done?.join(" "))
}

/// Rejects empty/odd actions, unparsable keys and duplicate actions or keys.
pub fn validate_keybindings(bindings: &[Keybinding]) -> AppResult<()> {
    let mut actions = HashSet::new();
    let mut keys = HashSet::new();
    for b in bindings {
        let action = b.action.trim();
        if action.is_empty() || action.len() > 100 || action.chars().any(char::is_control) {
            return Err(invalid("keybinding action is empty or invalid"));
        }
        if !actions.insert(action.to_string()) {
            return Err(invalid(format!("duplicate keybinding action `{action}`")));
        }
        let norm = normalize_keys(&b.keys)?;
        if !keys.insert(norm) {
            return Err(invalid(format!("keys `{}` are bound twice", b.keys)));
        }
    }
    Ok(())
}

pub fn load_keybindings(dir: &Path) -> Vec<Keybinding> {
    fs::read_to_string(dir.join(KEYBINDINGS_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_keybindings(dir: &Path, bindings: &[Keybinding]) -> AppResult<Vec<Keybinding>> {
    validate_keybindings(bindings)?;
    let json = serde_json::to_vec_pretty(bindings)
        .map_err(|e| AppError::new(ErrorKind::Internal, e.to_string()))?;
    atomic_write(&dir.join(KEYBINDINGS_FILE), &json)?;
    Ok(bindings.to_vec())
}

#[cfg(test)]
mod tests;
