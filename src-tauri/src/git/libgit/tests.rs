use std::path::Path;

use crate::git::fixtures::{self, TestRepo};
use crate::git::libgit::LibGit;
use crate::git::service::GitService;
use crate::git::GitState;
use crate::ipc::error::ErrorKind;
use crate::ipc::types::*;

const CTX3: DiffOptions = DiffOptions {
    context_lines: 3,
    ignore_whitespace: false,
};

fn file_diff(t: &TestRepo, oid: git2::Oid, path: &str, opts: &DiffOptions) -> FileDiff {
    LibGit
        .commit_file_diff(&t.repo, &oid.to_string(), path, opts)
        .unwrap()
}

fn kinds(diff: &FileDiff) -> Vec<LineKind> {
    diff.hunks
        .iter()
        .flat_map(|h| h.lines.iter().map(|l| l.kind))
        .collect()
}

// ------------------------------------------------------------ repo / state

#[test]
fn info_for_unborn_and_populated_repo() {
    let t = fixtures::empty();
    let info = LibGit.repo_info(&t.repo, "id-1").unwrap();
    assert_eq!(
        info.head,
        HeadState::Unborn {
            name: "main".into()
        }
    );
    assert_eq!(info.state, RepoState::Clean);
    assert!(!info.is_bare);
    assert_eq!(info.id, "id-1");

    let (t, oids) = fixtures::linear(2);
    let info = LibGit.repo_info(&t.repo, "x").unwrap();
    assert_eq!(
        info.head,
        HeadState::Branch {
            name: "main".into(),
            oid: oids[1].to_string()
        }
    );
    t.repo.set_head_detached(oids[0]).unwrap();
    let info = LibGit.repo_info(&t.repo, "x").unwrap();
    assert_eq!(
        info.head,
        HeadState::Detached {
            oid: oids[0].to_string()
        }
    );
}

#[test]
fn open_accepts_subdirectories_and_rejects_non_repos() {
    let (t, _) = fixtures::linear(1);
    t.write("deep/er/file.txt", "x");
    let repo = LibGit.open(&t.root().join("deep").join("er")).unwrap();
    assert!(repo.workdir().is_some());
    let plain = tempfile::tempdir().unwrap();
    let Err(err) = LibGit.open(plain.path()) else {
        panic!("expected failure");
    };
    assert_eq!(err.kind, ErrorKind::NotARepo);
}

#[test]
fn state_registry_returns_same_id_and_closes() {
    let (t, _) = fixtures::linear(1);
    t.write("sub/x.txt", "x");
    let state = GitState::default();
    let (_, a) = state.open(&t.root()).unwrap();
    let (_, b) = state.open(&t.root()).unwrap();
    let (_, c) = state.open(&t.root().join("sub")).unwrap();
    assert_eq!(a.id, b.id);
    assert_eq!(a.id, c.id);
    assert!(state.with_repo(&a.id, |s, r| s.repo_info(r, &a.id)).is_ok());
    let other = fixtures::linear(1).0;
    let (_, d) = state.open(&other.root()).unwrap();
    assert_ne!(a.id, d.id);
    state.close(&a.id).unwrap();
    assert!(state.entry(&a.id).is_err());
    assert!(state.close(&a.id).is_err());
    assert!(state.entry(&d.id).is_ok());
}

#[test]
fn graph_cache_is_invalidated_and_rebuilt() {
    let (mut t, _) = fixtures::linear(2);
    let state = GitState::default();
    let (entry, info) = state.open(&t.root()).unwrap();
    let filter = crate::git::default_filter();
    assert_eq!(state.graph_load(&info.id, filter).unwrap().row_count, 2);
    t.write("file.txt", "more\n");
    t.commit_all("third");
    // Still the cached graph until invalidated.
    assert_eq!(state.graph(&info.id).unwrap().meta().row_count, 2);
    entry.invalidate_graph();
    assert_eq!(state.graph(&info.id).unwrap().meta().row_count, 3);
}

#[test]
fn init_creates_repo_with_initial_branch() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("new").join("repo");
    let repo = LibGit
        .init(&InitRequest {
            path: path.to_string_lossy().into_owned(),
            bare: false,
            initial_branch: Some("trunk".into()),
        })
        .unwrap();
    let info = LibGit.repo_info(&repo, "i").unwrap();
    assert_eq!(
        info.head,
        HeadState::Unborn {
            name: "trunk".into()
        }
    );
    assert_eq!(info.name, "repo");
}

// ------------------------------------------------------------ commit details and diffs

#[test]
fn commit_details_lists_files_with_stats_and_renames() {
    let (t, first, second) = fixtures::renames();
    let d = LibGit.commit_details(&t.repo, &second.to_string()).unwrap();
    assert_eq!(d.parents, vec![first.to_string()]);
    assert_eq!(d.summary, "rename");
    assert_eq!(d.author.name, "Test User");
    assert_eq!(d.files.len(), 1);
    let f = &d.files[0];
    assert_eq!(f.path, "new.txt");
    assert_eq!(f.old_path.as_deref(), Some("old.txt"));
    assert_eq!(f.status, ChangeStatus::Renamed);
    assert_eq!((f.additions, f.deletions), (1, 1));
    assert!(!f.binary);

    let root = LibGit.commit_details(&t.repo, &first.to_string()).unwrap();
    assert!(root.parents.is_empty());
    assert_eq!(root.files[0].status, ChangeStatus::Added);
    assert_eq!(root.files[0].additions, 20);
    assert_eq!(root.refs.len(), 0);
    assert_eq!(d.refs[0].name, "main");
}

#[test]
fn commit_details_splits_summary_and_body() {
    let mut t = TestRepo::new();
    t.write("f", "x");
    let oid = t.commit_all("subject line\n\nbody one\nbody two\n");
    let d = LibGit.commit_details(&t.repo, &oid.to_string()).unwrap();
    assert_eq!(d.summary, "subject line");
    assert_eq!(d.body, "body one\nbody two");
    let e = LibGit.commit_details(&t.repo, "zz").unwrap_err();
    assert_eq!(e.kind, ErrorKind::InvalidInput);
}

#[test]
fn diff_add_delete_and_modify() {
    let mut t = TestRepo::new();
    t.write("keep.txt", "a\nb\nc\n");
    t.write("gone.txt", "bye\n");
    let c1 = t.commit_all("one");
    t.write("keep.txt", "a\nB\nc\n");
    t.remove("gone.txt");
    t.write("added.txt", "hello\nworld\n");
    let c2 = t.commit_all("two");

    let add = file_diff(&t, c1, "keep.txt", &CTX3);
    assert_eq!(add.status, ChangeStatus::Added);
    assert_eq!(kinds(&add), vec![LineKind::Add; 3]);
    assert_eq!(add.hunks[0].lines[0].new_lineno, Some(1));
    assert_eq!(add.hunks[0].lines[0].old_lineno, None);

    let modify = file_diff(&t, c2, "keep.txt", &CTX3);
    assert_eq!(modify.status, ChangeStatus::Modified);
    assert_eq!(
        kinds(&modify),
        vec![
            LineKind::Context,
            LineKind::Delete,
            LineKind::Add,
            LineKind::Context
        ]
    );
    let h = &modify.hunks[0];
    assert!(h.header.starts_with("@@ -1,3 +1,3 @@"));
    assert_eq!(
        (h.old_start, h.old_lines, h.new_start, h.new_lines),
        (1, 3, 1, 3)
    );
    assert_eq!(h.lines[1].content, "b");
    assert_eq!(h.lines[1].old_lineno, Some(2));
    assert_eq!(h.lines[2].content, "B");
    assert_eq!(h.lines[2].new_lineno, Some(2));

    let del = file_diff(&t, c2, "gone.txt", &CTX3);
    assert_eq!(del.status, ChangeStatus::Deleted);
    assert_eq!(kinds(&del), vec![LineKind::Delete]);
    assert_eq!(
        file_diff(&t, c2, "added.txt", &CTX3).status,
        ChangeStatus::Added
    );

    let err = LibGit
        .commit_file_diff(&t.repo, &c2.to_string(), "nope.txt", &CTX3)
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
}

#[test]
fn diff_follows_renames() {
    let (t, _, second) = fixtures::renames();
    let d = file_diff(&t, second, "new.txt", &CTX3);
    assert_eq!(d.status, ChangeStatus::Renamed);
    assert_eq!(d.old_path.as_deref(), Some("old.txt"));
    assert_eq!(d.path, "new.txt");
    let adds = kinds(&d).iter().filter(|k| **k == LineKind::Add).count();
    assert_eq!(adds, 1);
}

#[test]
fn diff_detects_binary_files() {
    let mut t = TestRepo::new();
    t.write("bin.dat", [0u8, 159, 146, 150, 0, 1, 2, 3]);
    let c = t.commit_all("binary");
    let d = file_diff(&t, c, "bin.dat", &CTX3);
    assert!(d.binary);
    assert!(d.hunks.is_empty());
    let details = LibGit.commit_details(&t.repo, &c.to_string()).unwrap();
    assert!(details.files[0].binary);
    assert_eq!(
        (details.files[0].additions, details.files[0].deletions),
        (0, 0)
    );
}

#[test]
fn diff_marks_missing_trailing_newline() {
    let (t, _, second) = fixtures::no_trailing_newline();
    let d = file_diff(&t, second, "nonl.txt", &CTX3);
    let lines: Vec<_> = d.hunks.iter().flat_map(|h| h.lines.iter()).collect();
    let marks = lines
        .iter()
        .filter(|l| l.kind == LineKind::NoNewline)
        .count();
    assert_eq!(marks, 2, "one marker after the old line, one after the new");
    assert!(lines
        .iter()
        .filter(|l| l.kind == LineKind::NoNewline)
        .all(|l| l.old_lineno.is_none() && l.new_lineno.is_none()));
    let del = lines.iter().find(|l| l.kind == LineKind::Delete).unwrap();
    assert_eq!(del.content, "last");
}

#[test]
fn diff_preserves_crlf() {
    let (t, first, second) = fixtures::crlf();
    let d = file_diff(&t, second, "crlf.txt", &CTX3);
    let del = d
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .find(|l| l.kind == LineKind::Delete)
        .unwrap();
    assert_eq!(del.content, "two\r");
    let add = file_diff(&t, first, "crlf.txt", &CTX3);
    assert!(add.hunks[0].lines.iter().all(|l| l.content.ends_with('\r')));
}

#[test]
fn diff_options_context_and_whitespace() {
    let mut t = TestRepo::new();
    let base: String = (1..=20).map(|i| format!("line {i}\n")).collect();
    t.write("f.txt", &base);
    t.commit_all("base");
    t.write("f.txt", base.replace("line 10\n", "line ten\n"));
    let c = t.commit_all("edit");
    let ctx0 = file_diff(
        &t,
        c,
        "f.txt",
        &DiffOptions {
            context_lines: 0,
            ignore_whitespace: false,
        },
    );
    assert_eq!(kinds(&ctx0), vec![LineKind::Delete, LineKind::Add]);
    let ctx1 = file_diff(
        &t,
        c,
        "f.txt",
        &DiffOptions {
            context_lines: 1,
            ignore_whitespace: false,
        },
    );
    assert_eq!(kinds(&ctx1).len(), 4);

    // Whitespace-only change disappears when ignored.
    t.write("g.txt", "a b\n");
    t.commit_all("g");
    t.write("g.txt", "a   b\n");
    let ws = t.commit_all("ws");
    let plain = file_diff(&t, ws, "g.txt", &CTX3);
    assert!(!plain.hunks.is_empty());
    let ignored = file_diff(
        &t,
        ws,
        "g.txt",
        &DiffOptions {
            context_lines: 3,
            ignore_whitespace: true,
        },
    );
    assert!(ignored.hunks.is_empty());
}

// ------------------------------------------------------------ working tree

#[test]
fn worktree_diff_staged_unstaged_and_untracked() {
    let mut t = TestRepo::new();
    t.write("tracked.txt", "one\ntwo\n");
    t.commit_all("base");
    t.write("tracked.txt", "one\nTWO\n");
    {
        let mut index = t.repo.index().unwrap();
        index.add_path(Path::new("tracked.txt")).unwrap();
        index.write().unwrap();
    }
    t.write("tracked.txt", "one\nTWO\nthree\n");
    t.write("untracked.txt", "fresh\nfile\n");

    let staged = LibGit
        .worktree_file_diff(&t.repo, "tracked.txt", true, &CTX3)
        .unwrap();
    let staged_kinds = kinds(&staged);
    assert_eq!(
        staged_kinds.iter().filter(|k| **k == LineKind::Add).count(),
        1
    );
    assert_eq!(
        staged.hunks[0]
            .lines
            .iter()
            .find(|l| l.kind == LineKind::Add)
            .unwrap()
            .content,
        "TWO"
    );

    let unstaged = LibGit
        .worktree_file_diff(&t.repo, "tracked.txt", false, &CTX3)
        .unwrap();
    let adds: Vec<_> = unstaged
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .filter(|l| l.kind == LineKind::Add)
        .map(|l| l.content.as_str())
        .collect();
    assert_eq!(adds, vec!["three"]);

    let untracked = LibGit
        .worktree_file_diff(&t.repo, "untracked.txt", false, &CTX3)
        .unwrap();
    assert_eq!(untracked.status, ChangeStatus::Untracked);
    assert_eq!(kinds(&untracked), vec![LineKind::Add, LineKind::Add]);

    let none = LibGit
        .worktree_file_diff(&t.repo, "nothing.txt", false, &CTX3)
        .unwrap();
    assert!(none.hunks.is_empty());
}

#[test]
fn status_in_normal_state() {
    let mut t = TestRepo::new();
    t.write("a.txt", "a\n");
    t.write("b.txt", "b\n");
    t.write("c.txt", "c\n");
    t.commit_all("base");
    // staged: modify a, add new; unstaged: modify b, delete c; untracked file.
    t.write("a.txt", "a2\n");
    t.write("staged_new.txt", "n\n");
    {
        let mut index = t.repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.add_path(Path::new("staged_new.txt")).unwrap();
        index.write().unwrap();
    }
    t.write("b.txt", "b2\nmore\n");
    t.remove("c.txt");
    t.write("dir/u.txt", "u\n");

    let s = LibGit.status(&t.repo).unwrap();
    assert_eq!(s.state, RepoState::Clean);
    assert!(s.conflicted.is_empty());
    let staged: Vec<_> = s
        .staged
        .iter()
        .map(|f| (f.path.as_str(), f.status))
        .collect();
    assert_eq!(
        staged,
        vec![
            ("a.txt", ChangeStatus::Modified),
            ("staged_new.txt", ChangeStatus::Added)
        ]
    );
    let unstaged: Vec<_> = s
        .unstaged
        .iter()
        .map(|f| (f.path.as_str(), f.status))
        .collect();
    assert_eq!(
        unstaged,
        vec![
            ("b.txt", ChangeStatus::Modified),
            ("c.txt", ChangeStatus::Deleted),
            ("dir/u.txt", ChangeStatus::Untracked)
        ]
    );
    let b = s.unstaged.iter().find(|f| f.path == "b.txt").unwrap();
    assert_eq!((b.additions, b.deletions), (2, 1));
}

#[test]
fn status_on_unborn_repo_lists_staged_and_untracked() {
    let t = TestRepo::new();
    t.write("x.txt", "x\n");
    let s = LibGit.status(&t.repo).unwrap();
    assert!(s.staged.is_empty());
    assert_eq!(s.unstaged[0].status, ChangeStatus::Untracked);
    let mut index = t.repo.index().unwrap();
    index.add_path(Path::new("x.txt")).unwrap();
    index.write().unwrap();
    let s = LibGit.status(&t.repo).unwrap();
    assert_eq!(s.staged[0].status, ChangeStatus::Added);
    assert!(s.unstaged.is_empty());
}

#[test]
fn status_reports_conflicts_and_merge_state() {
    let t = fixtures::conflicted_merge();
    let s = LibGit.status(&t.repo).unwrap();
    assert_eq!(s.state, RepoState::Merge);
    assert_eq!(s.conflicted.len(), 1);
    assert_eq!(s.conflicted[0].path, "conflict.txt");
    assert_eq!(s.conflicted[0].status, ChangeStatus::Conflicted);
    assert!(s.staged.iter().all(|f| f.path != "conflict.txt"));
    assert!(s.unstaged.iter().all(|f| f.path != "conflict.txt"));
    let info = LibGit.repo_info(&t.repo, "r").unwrap();
    assert_eq!(info.state, RepoState::Merge);
}

// ------------------------------------------------------------ refs

#[test]
fn refs_report_upstream_ahead_and_behind() {
    let mut t = fixtures::ahead_behind();
    let snap = LibGit.refs_list(&mut t.repo).unwrap();
    assert!(matches!(snap.head, HeadState::Branch { ref name, .. } if name == "main"));
    let main = snap.local.iter().find(|b| b.name == "main").unwrap();
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
    assert_eq!((main.ahead, main.behind), (2, 1));
    assert!(main.is_head);
    assert_eq!(main.full_name, "refs/heads/main");
    let remote = snap
        .remote
        .iter()
        .find(|b| b.name == "origin/main")
        .unwrap();
    assert_eq!(remote.remote.as_deref(), Some("origin"));
    assert!(!remote.is_head);
    assert!(snap.tags.is_empty());
}

#[test]
fn refs_list_tags_peeled_with_annotation() {
    let (mut t, first, second) = fixtures::tags();
    let snap = LibGit.refs_list(&mut t.repo).unwrap();
    assert_eq!(snap.tags.len(), 2);
    let light = &snap.tags[0];
    assert_eq!(light.name, "v0.1");
    assert!(!light.annotated);
    assert_eq!(light.message, None);
    assert_eq!(light.oid, first.to_string());
    let ann = &snap.tags[1];
    assert_eq!(ann.name, "v1.0");
    assert!(ann.annotated);
    assert_eq!(ann.message.as_deref(), Some("release one"));
    assert_eq!(ann.oid, second.to_string(), "peeled to the commit");
}

#[test]
fn stash_list_reports_entries() {
    let mut t = fixtures::stash();
    let stashes = LibGit.stash_list(&mut t.repo).unwrap();
    assert_eq!(stashes.len(), 1);
    assert_eq!(stashes[0].index, 0);
    assert!(stashes[0].message.contains("my stash"));
    assert_eq!(stashes[0].branch.as_deref(), Some("main"));
    assert!(stashes[0].time > 0.0);
    let snap = LibGit.refs_list(&mut t.repo).unwrap();
    assert_eq!(snap.stashes, stashes);
}
