use std::path::Path;
use std::time::Instant;

use git2::Repository;

use super::*;
use crate::git::cli::GitCli;
use crate::git::fixtures::{self, TestRepo};
use crate::git::refs_write::RefWriteService;
use crate::git::remote::net::NetSession;

fn cli() -> GitCli {
    GitCli::new()
}

fn run(dir: &Path, args: &[&str]) -> String {
    cli().run(dir, args).unwrap().stdout_str()
}

// ------------------------------------------------------------ validation

#[test]
fn relative_path_rules() {
    assert_eq!(relative_path("a/b.txt").unwrap(), "a/b.txt");
    assert_eq!(relative_path("./a\\b").unwrap(), "a/b");
    for bad in ["", "/etc/passwd", "../x", "a/../../x", "a\0b"] {
        assert_eq!(
            relative_path(bad).unwrap_err().kind,
            ErrorKind::InvalidInput,
            "{bad:?}"
        );
    }
}

#[test]
fn injection_attempts_are_neutralised_or_rejected() {
    // Option-like paths stay after `--`.
    let a = submodule::update_args(&SubmoduleUpdateRequest {
        paths: vec!["--upload-pack=x".into(), "-x".into()],
        init: true,
        recursive: true,
    })
    .unwrap();
    let dd = a.iter().position(|s| s == "--").unwrap();
    assert!(a[..dd].iter().all(|s| !s.contains("upload-pack")));
    assert_eq!(&a[dd + 1..], ["--upload-pack=x", "-x"]);
    let h = history::args("--upload-pack=x", 5).unwrap();
    let dd = h.iter().position(|s| s == "--").unwrap();
    assert_eq!(h[dd + 1], "--upload-pack=x");
    assert!(h[..dd].iter().all(|s| !s.contains("upload-pack")));
    // Branches that could be options are rejected.
    for b in ["--upload-pack=x", "-x", "", "a b", "HEAD", "a..b"] {
        assert!(worktree::validate_branch(b).is_err(), "{b:?}");
    }
    assert!(reflog::full_ref_name("--upload-pack=x").is_err());
    assert!(reflog::full_ref_name("-x").is_err());
    let t = fixtures::linear(1).0;
    assert!(blame::blame(&t.repo, "f.txt", Some("--upload-pack=x")).is_err());
}

#[test]
fn file_history_with_option_like_path_runs_safely() {
    let mut t = TestRepo::new();
    t.write("-x", "one\n");
    t.commit_all("add dash file");
    let h = history::file_history(&cli(), &t.root(), "-x", 10).unwrap();
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].path, "-x");
    // Pathspec magic is literal.
    let none = history::file_history(&cli(), &t.root(), ":(glob)*", 10).unwrap();
    assert!(none.is_empty());
}

// ------------------------------------------------------------ submodules

/// Superproject with one submodule `sub` (origin has two commits).
fn with_submodule() -> (TestRepo, TestRepo) {
    let mut origin = TestRepo::new();
    origin.write("lib.txt", "one\n");
    origin.commit_all("lib 1");
    origin.write("lib.txt", "one\ntwo\n");
    origin.commit_all("lib 2");
    let mut sup = TestRepo::new();
    sup.write("readme.md", "hi\n");
    sup.commit_all("init");
    let url = origin.root().to_string_lossy().into_owned();
    run(
        &sup.root(),
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "--",
            &url,
            "sub",
        ],
    );
    run(&sup.root(), &["config", "protocol.file.allow", "always"]);
    run(&sup.root(), &["add", "-A"]);
    run(
        &sup.root(),
        &[
            "-c",
            "user.name=T",
            "-c",
            "user.email=t@x.io",
            "commit",
            "-q",
            "-m",
            "add submodule",
        ],
    );
    (sup, origin)
}

fn only(repo: &Repository) -> SubmoduleInfo {
    let mut l = submodule::list(repo).unwrap();
    assert_eq!(l.len(), 1);
    l.remove(0)
}

#[test]
fn submodule_status_states() {
    let (sup, origin) = with_submodule();
    let info = only(&sup.repo);
    assert_eq!(info.name, "sub");
    assert_eq!(info.path, "sub");
    assert_eq!(info.status, SubmoduleStatus::UpToDate);
    assert_eq!(info.head_oid, Some(origin.head().to_string()));
    assert!(info.url.is_some());

    // Dirty workdir -> modified.
    let sub = sup.root().join("sub");
    std::fs::write(sub.join("lib.txt"), "changed\n").unwrap();
    assert_eq!(only(&sup.repo).status, SubmoduleStatus::Modified);
    run(&sub, &["checkout", "--", "lib.txt"]);
    assert_eq!(only(&sup.repo).status, SubmoduleStatus::UpToDate);

    // Checked-out commit differs from the recorded one -> out of date.
    run(&sub, &["checkout", "-q", "HEAD~1"]);
    let info = only(&sup.repo);
    assert_eq!(info.status, SubmoduleStatus::OutOfDate);
    assert_ne!(info.head_oid, Some(origin.head().to_string()));

    // Not checked out -> uninitialized.
    run(&sup.root(), &["submodule", "deinit", "-f", "--", "sub"]);
    assert_eq!(only(&sup.repo).status, SubmoduleStatus::Uninitialized);
}

#[test]
fn submodule_update_initialises_and_checks_out() {
    let (sup, origin) = with_submodule();
    run(&sup.root(), &["submodule", "deinit", "-f", "--", "sub"]);
    assert_eq!(only(&sup.repo).status, SubmoduleStatus::Uninitialized);
    let args = submodule::update_args(&SubmoduleUpdateRequest {
        paths: vec!["sub".into()],
        init: true,
        recursive: true,
    })
    .unwrap();
    let sess = NetSession::plain(cli());
    sess.run_ok(&sup.root(), &args).unwrap();
    let info = only(&Repository::open(sup.root()).unwrap());
    assert_eq!(info.status, SubmoduleStatus::UpToDate);
    assert_eq!(info.head_oid, Some(origin.head().to_string()));
}

// ------------------------------------------------------------ worktrees

#[test]
fn porcelain_parsing() {
    let text = "worktree /r/main\nHEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nbranch refs/heads/main\n\n\
                worktree /r/wt\nHEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\ndetached\nlocked why\n\n\
                worktree /r/gone\nHEAD cccccccccccccccccccccccccccccccccccccccc\nbranch refs/heads/feat/x\nprunable gitdir file points to non-existent location\n";
    let l = worktree::parse_porcelain(text);
    assert_eq!(l.len(), 3);
    assert!(l[0].is_main && l[0].branch.as_deref() == Some("main"));
    assert!(!l[1].is_main && l[1].branch.is_none() && l[1].locked && !l[1].prunable);
    assert_eq!(l[2].branch.as_deref(), Some("feat/x"));
    assert!(l[2].prunable && !l[2].locked);
}

#[test]
fn worktree_add_list_remove() {
    let (t, _) = fixtures::linear(2);
    let root = t.root();
    let outside = tempfile::tempdir().unwrap();
    let wt = outside.path().join("wt-new");
    let path = wt.to_string_lossy().into_owned();
    let added = worktree::add(
        &cli(),
        &root,
        &WorktreeAddRequest {
            path: path.clone(),
            branch: "feature/wt".into(),
            create_branch: true,
        },
    )
    .unwrap();
    assert_eq!(added.branch.as_deref(), Some("feature/wt"));
    assert!(!added.is_main && !added.locked);
    assert!(wt.join("f.txt").exists() || std::fs::read_dir(&wt).unwrap().count() > 0);

    let all = worktree::list(&cli(), &root).unwrap();
    assert_eq!(all.len(), 2);
    assert!(all[0].is_main);
    assert_eq!(all[0].branch.as_deref(), Some("main"));

    // Existing, non-empty target and duplicate checkout are rejected.
    assert!(worktree::add(
        &cli(),
        &root,
        &WorktreeAddRequest {
            path: path.clone(),
            branch: "other".into(),
            create_branch: true
        }
    )
    .is_err());
    // Existing branch into an empty directory.
    t.repo
        .branch(
            "existing",
            &t.repo.head().unwrap().peel_to_commit().unwrap(),
            false,
        )
        .unwrap();
    let empty = outside.path().join("empty");
    std::fs::create_dir(&empty).unwrap();
    let second = worktree::add(
        &cli(),
        &root,
        &WorktreeAddRequest {
            path: empty.to_string_lossy().into_owned(),
            branch: "existing".into(),
            create_branch: false,
        },
    )
    .unwrap();
    assert_eq!(second.branch.as_deref(), Some("existing"));

    // Removal: main refused, unknown refused, linked ok.
    assert!(worktree::remove(&cli(), &root, &root.to_string_lossy(), false).is_err());
    assert!(worktree::remove(&cli(), &root, "--force", false).is_err());
    worktree::remove(&cli(), &root, &path, false).unwrap();
    assert!(!wt.exists());
    // Dirty worktree needs force.
    std::fs::write(empty.join("dirty.txt"), "x").unwrap();
    run(&empty, &["add", "dirty.txt"]);
    assert!(worktree::remove(&cli(), &root, &second.path, false).is_err());
    worktree::remove(&cli(), &root, &second.path, true).unwrap();
    assert_eq!(worktree::list(&cli(), &root).unwrap().len(), 1);
}

#[test]
fn worktree_add_validation() {
    let (t, _) = fixtures::linear(1);
    let req = |path: &str, branch: &str| WorktreeAddRequest {
        path: path.into(),
        branch: branch.into(),
        create_branch: true,
    };
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("file"), "x").unwrap();
    let ok = dir.path().join("new").to_string_lossy().into_owned();
    for (p, b) in [
        ("relative/path", "b"),
        ("", "b"),
        (dir.path().to_str().unwrap(), "b"),
        (ok.as_str(), "--upload-pack=x"),
        (ok.as_str(), "-x"),
        (ok.as_str(), "bad name"),
    ] {
        let e = worktree::add(&cli(), &t.root(), &req(p, b)).unwrap_err();
        assert_eq!(e.kind, ErrorKind::InvalidInput, "{p:?} {b:?}");
    }
}

// ------------------------------------------------------------ blame

#[test]
fn blame_three_commit_history() {
    let mut t = TestRepo::new();
    t.write("f.txt", "alpha\nbeta\ngamma\n");
    let c1 = t.commit_all_by("Alice", "a@x.io", "first");
    t.write("f.txt", "alpha\nBETA\ngamma\n");
    let c2 = t.commit_all_by("Bob", "b@x.io", "second: shout beta");
    t.write("f.txt", "alpha\nBETA\ngamma\ndelta\n");
    let c3 = t.commit_all_by("Carol", "c@x.io", "third");

    let r = blame::blame(&t.repo, "f.txt", None).unwrap();
    assert_eq!(r.path, "f.txt");
    assert_eq!(r.lines, ["alpha", "BETA", "gamma", "delta"]);
    let by = |line: u32| {
        r.hunks
            .iter()
            .find(|h| h.start_line <= line && line < h.start_line + h.line_count)
            .unwrap()
    };
    assert_eq!(by(1).oid, c1.to_string());
    assert_eq!(by(1).author_name, "Alice");
    assert_eq!(by(2).oid, c2.to_string());
    assert_eq!(by(2).author_name, "Bob");
    assert_eq!(by(2).summary, "second: shout beta");
    assert_eq!(by(3).oid, c1.to_string());
    assert_eq!(by(4).oid, c3.to_string());
    assert!(by(4).author_time > by(1).author_time);
    let total: u32 = r.hunks.iter().map(|h| h.line_count).sum();
    assert_eq!(total, 4);

    // At an older revision.
    let old = blame::blame(&t.repo, "f.txt", Some(&c2.to_string())).unwrap();
    assert_eq!(old.lines.len(), 3);
    assert!(old.hunks.iter().all(|h| h.oid != c3.to_string()));

    assert_eq!(
        blame::blame(&t.repo, "missing.txt", None).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    assert_eq!(
        blame::blame(&t.repo, "f.txt", Some("nope"))
            .unwrap_err()
            .kind,
        ErrorKind::RefNotFound
    );
}

#[test]
fn blame_follows_a_rename() {
    let (t, first, second) = fixtures::renames();
    let r = blame::blame(&t.repo, "new.txt", None).unwrap();
    assert_eq!(r.lines.len(), 20);
    let changed = r
        .hunks
        .iter()
        .find(|h| h.oid == second.to_string())
        .unwrap();
    assert_eq!(changed.line_count, 1);
    assert_eq!(changed.start_line, 8);
    let old = r.hunks.iter().find(|h| h.oid == first.to_string()).unwrap();
    assert_eq!(old.orig_path, "old.txt");
}

#[test]
fn blame_large_file_is_fast_enough() {
    let mut t = TestRepo::new();
    let mut lines: Vec<String> = (0..10_000).map(|i| format!("line {i}")).collect();
    t.write("big.txt", lines.join("\n") + "\n");
    t.commit_all("big 1");
    for round in 0..2 {
        for i in (round..10_000).step_by(7) {
            lines[i] = format!("line {i} edited {round}");
        }
        t.write("big.txt", lines.join("\n") + "\n");
        t.commit_all(&format!("big edit {round}"));
    }
    let start = Instant::now();
    let r = blame::blame(&t.repo, "big.txt", None).unwrap();
    let took = start.elapsed();
    assert_eq!(r.lines.len(), 10_000);
    assert_eq!(r.hunks.iter().map(|h| h.line_count).sum::<u32>(), 10_000);
    // Generous bound: typically well under a second.
    assert!(took.as_secs() < 30, "blame took {took:?}");
}

// ------------------------------------------------------------ history

#[test]
fn file_history_follows_two_renames() {
    let mut t = TestRepo::new();
    let body: String = (0..20).map(|i| format!("line number {i}\n")).collect();
    t.write("a.txt", &body);
    let c1 = t.commit_all("add a");
    t.remove("a.txt");
    t.write("b.txt", body.replace("number 3", "three"));
    let c2 = t.commit_all("rename a to b");
    t.write(
        "b.txt",
        body.replace("number 3", "three")
            .replace("number 9", "nine"),
    );
    let c3 = t.commit_all("edit b");
    t.remove("b.txt");
    t.write(
        "dir/c.txt",
        body.replace("number 3", "three")
            .replace("number 9", "nine"),
    );
    let c4 = t.commit_all("move b to dir/c");
    t.write("unrelated.txt", "x\n");
    t.commit_all("unrelated");

    let h = history::file_history(&cli(), &t.root(), "dir/c.txt", 50).unwrap();
    let got: Vec<(String, String, ChangeStatus)> = h
        .iter()
        .map(|e| (e.commit.oid.clone(), e.path.clone(), e.status))
        .collect();
    assert_eq!(
        got,
        vec![
            (c4.to_string(), "dir/c.txt".into(), ChangeStatus::Renamed),
            (c3.to_string(), "b.txt".into(), ChangeStatus::Modified),
            (c2.to_string(), "b.txt".into(), ChangeStatus::Renamed),
            (c1.to_string(), "a.txt".into(), ChangeStatus::Added),
        ]
    );
    assert_eq!(h[0].commit.summary, "move b to dir/c");
    assert_eq!(h[0].commit.short_oid.len(), 7);
    assert_eq!(h[0].commit.author_name, "Test User");

    let limited = history::file_history(&cli(), &t.root(), "dir/c.txt", 2).unwrap();
    assert_eq!(limited.len(), 2);
    assert!(history::file_history(&cli(), &t.root(), "dir/c.txt", 0).is_err());
}

// ------------------------------------------------------------ reflog

#[test]
fn reflog_after_commits_and_reset() {
    let (t, oids) = fixtures::linear(3);
    let svc = crate::git::libgit::LibGit;
    svc.reset(
        &t.repo,
        &ResetRequest {
            target: "HEAD~1".into(),
            mode: ResetMode::Hard,
        },
        false,
    )
    .unwrap();
    let log = reflog::reflog(&t.repo, "HEAD", 100).unwrap();
    assert!(log.len() >= 4, "{log:?}");
    assert_eq!(log[0].index, 0);
    assert_eq!(log[0].new_oid, oids[1].to_string());
    assert_eq!(log[0].old_oid, oids[2].to_string());
    assert!(log[0].message.to_lowercase().contains("reset"));
    assert_eq!(log[1].new_oid, oids[2].to_string());
    assert!(log[1].message.contains("commit"));
    assert!(!log[0].committer.name.is_empty());

    let limited = reflog::reflog(&t.repo, "HEAD", 2).unwrap();
    assert_eq!(limited.len(), 2);
    let branch = reflog::reflog(&t.repo, "main", 100).unwrap();
    assert!(!branch.is_empty());
    let full = reflog::reflog(&t.repo, "refs/heads/main", 100).unwrap();
    assert_eq!(full.len(), branch.len());
    assert!(reflog::reflog(&t.repo, "HEAD", 0).is_err());
    assert!(reflog::reflog(&t.repo, "bad name", 5).is_err());
    assert!(reflog::reflog(&t.repo, "nope", 5).unwrap().is_empty());
}
