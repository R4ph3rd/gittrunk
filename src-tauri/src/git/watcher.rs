//! Repository file watcher: debounced `notify` events classified into
//! `ChangeScope`s. Classification is a pure function.

use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use notify::{EventKind, RecursiveMode, Watcher};

use crate::ipc::types::ChangeScope;

pub const DEBOUNCE: Duration = Duration::from_millis(150);

/// Keeps the underlying watcher (and its debounce thread) alive.
pub struct RepoWatcher {
    _watcher: notify::RecommendedWatcher,
}

/// Classifies one changed path. `None` means the path is noise.
pub fn classify_path(path: &Path, workdir: Option<&Path>, git_dir: &Path) -> Option<ChangeScope> {
    if let Ok(rel) = path.strip_prefix(git_dir) {
        return classify_git_dir(rel);
    }
    if let Some(workdir) = workdir {
        if let Ok(rel) = path.strip_prefix(workdir) {
            // `.git` inside the workdir when `git_dir` was given differently.
            let mut comps = rel.components();
            if let Some(Component::Normal(first)) = comps.next() {
                if first == ".git" {
                    return classify_git_dir(comps.as_path());
                }
            }
        }
    }
    Some(ChangeScope::Worktree)
}

fn classify_git_dir(rel: &Path) -> Option<ChangeScope> {
    let file_name = rel.file_name()?.to_string_lossy();
    if file_name.ends_with(".lock") {
        return None;
    }
    let mut comps = rel.components().filter_map(|c| match c {
        Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
        _ => None,
    });
    let first = comps.next()?;
    match first.as_str() {
        "objects" | "logs" => None,
        "HEAD" | "packed-refs" | "refs" => Some(ChangeScope::Refs),
        "index" => Some(ChangeScope::Index),
        "config" | "config.worktree" => Some(ChangeScope::Config),
        _ => Some(ChangeScope::Worktree),
    }
}

/// Classifies a batch of paths into a deduplicated, stably ordered scope list.
pub fn classify_paths(
    paths: &[PathBuf],
    workdir: Option<&Path>,
    git_dir: &Path,
) -> Vec<ChangeScope> {
    let mut scopes = Vec::new();
    for p in paths {
        if let Some(s) = classify_path(p, workdir, git_dir) {
            if !scopes.contains(&s) {
                scopes.push(s);
            }
        }
    }
    let order = |s: &ChangeScope| match s {
        ChangeScope::Refs => 0,
        ChangeScope::Index => 1,
        ChangeScope::Worktree => 2,
        ChangeScope::Config => 3,
    };
    scopes.sort_by_key(order);
    scopes
}

/// Starts watching `workdir` (when present) and `git_dir`. `on_change` is
/// called from a background thread once events have been quiet for `DEBOUNCE`.
pub fn start(
    workdir: Option<&Path>,
    git_dir: &Path,
    on_change: impl Fn(Vec<ChangeScope>) + Send + 'static,
) -> notify::Result<RepoWatcher> {
    let (tx, rx) = mpsc::channel::<Vec<PathBuf>>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            let _ = tx.send(event.paths);
        }
    })?;
    if let Some(dir) = workdir {
        watcher.watch(dir, RecursiveMode::Recursive)?;
        if !git_dir.starts_with(dir) {
            watcher.watch(git_dir, RecursiveMode::Recursive)?;
        }
    } else {
        watcher.watch(git_dir, RecursiveMode::Recursive)?;
    }

    let workdir = workdir.map(Path::to_path_buf);
    let git_dir = git_dir.to_path_buf();
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut paths = first;
            let mut disconnected = false;
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(more) => paths.extend(more),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        disconnected = true;
                        break;
                    }
                }
            }
            let scopes = classify_paths(&paths, workdir.as_deref(), &git_dir);
            if !scopes.is_empty() {
                on_change(scopes);
            }
            if disconnected {
                break;
            }
        }
    });
    Ok(RepoWatcher { _watcher: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots() -> (PathBuf, PathBuf) {
        let work = PathBuf::from("repo");
        let git = work.join(".git");
        (work, git)
    }

    fn scope(rel: &[&str]) -> Option<ChangeScope> {
        let (work, git) = roots();
        let mut p = work;
        for c in rel {
            p = p.join(c);
        }
        classify_path(&p, Some(&work_path()), &git)
    }

    fn work_path() -> PathBuf {
        roots().0
    }

    #[test]
    fn refs_head_and_packed_refs() {
        assert_eq!(scope(&[".git", "HEAD"]), Some(ChangeScope::Refs));
        assert_eq!(scope(&[".git", "packed-refs"]), Some(ChangeScope::Refs));
        assert_eq!(
            scope(&[".git", "refs", "heads", "main"]),
            Some(ChangeScope::Refs)
        );
    }

    #[test]
    fn index_and_config() {
        assert_eq!(scope(&[".git", "index"]), Some(ChangeScope::Index));
        assert_eq!(scope(&[".git", "config"]), Some(ChangeScope::Config));
    }

    #[test]
    fn noise_is_ignored() {
        assert_eq!(scope(&[".git", "objects", "ab", "cdef"]), None);
        assert_eq!(scope(&[".git", "index.lock"]), None);
        assert_eq!(scope(&[".git", "refs", "heads", "main.lock"]), None);
        assert_eq!(scope(&[".git", "logs", "HEAD"]), None);
    }

    #[test]
    fn other_paths_are_worktree() {
        assert_eq!(scope(&["src", "main.rs"]), Some(ChangeScope::Worktree));
        assert_eq!(scope(&[".git", "MERGE_HEAD"]), Some(ChangeScope::Worktree));
        assert_eq!(scope(&[".gitignore"]), Some(ChangeScope::Worktree));
    }

    #[test]
    fn batch_is_deduplicated_and_ordered() {
        let (work, git) = roots();
        let paths = vec![
            work.join("a.txt"),
            git.join("index"),
            work.join("b.txt"),
            git.join("refs").join("heads").join("x"),
            git.join("objects").join("aa"),
            git.join("index.lock"),
        ];
        assert_eq!(
            classify_paths(&paths, Some(&work), &git),
            vec![ChangeScope::Refs, ChangeScope::Index, ChangeScope::Worktree]
        );
    }

    #[test]
    fn only_noise_yields_nothing() {
        let (work, git) = roots();
        let paths = vec![git.join("objects").join("aa"), git.join("index.lock")];
        assert!(classify_paths(&paths, Some(&work), &git).is_empty());
    }

    #[test]
    fn debounced_events_reach_callback() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let git_dir = root.join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        let (tx, rx) = mpsc::channel();
        let _w = start(Some(&root), &git_dir, move |s| {
            let _ = tx.send(s);
        })
        .unwrap();
        std::fs::write(root.join("file.txt"), "x").unwrap();
        let scopes = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(scopes.contains(&ChangeScope::Worktree));
    }
}
