//! Tests of the embedded git shim. They run on every platform: the shim is
//! always compiled, only `GitCli::new()` picks it by `cfg(embedded_git)`.

use std::fs;

use crate::git::cli::{CliOptions, CliOutput, GitCli};
use crate::git::fixtures::{self, TestRepo};
use crate::ipc::error::ErrorKind;

/// Runs `git <args>` through the shim.
pub(super) fn sh(t: &TestRepo, args: &[&str]) -> CliOutput {
    sh_in(t, args, &CliOptions::default())
}

pub(super) fn sh_in(t: &TestRepo, args: &[&str], opts: &CliOptions) -> CliOutput {
    GitCli::embedded_for_tests()
        .run_raw(&t.root(), args, opts)
        .unwrap()
}

/// Like `sh` but asserts success.
pub(super) fn sh_ok(t: &TestRepo, args: &[&str]) -> CliOutput {
    let out = sh(t, args);
    assert_eq!(out.code, 0, "git {args:?} failed: {}", out.stderr);
    out
}

pub(super) fn stdin(text: &str) -> CliOptions {
    CliOptions {
        stdin: Some(text.as_bytes().to_vec()),
        ..CliOptions::default()
    }
}

/// The on-disk index (the fixture's own `Repository` caches its index).
pub(super) fn idx(t: &TestRepo) -> git2::Index {
    git2::Repository::open(t.root()).unwrap().index().unwrap()
}

pub(super) fn read(t: &TestRepo, rel: &str) -> String {
    fs::read_to_string(t.root().join(rel)).unwrap()
}

/// Two branches from one base: `main` and `topic`, each with one commit that
/// touches a different file. Returns the topic tip.
pub(super) fn diverged() -> (TestRepo, git2::Oid) {
    let mut t = TestRepo::new();
    t.write("base.txt", "base\n");
    let base = t.commit_all("base");
    t.checkout_branch("topic", base);
    let topic = t.commit_on("topic", "topic.txt", "topic\n", "topic change");
    t.commit_on("main", "main.txt", "main\n", "main change");
    (t, topic)
}

/// Both sides edit `conflict.txt`. HEAD is `main`. Returns (repo, other tip).
pub(super) fn conflicting() -> (TestRepo, git2::Oid) {
    let mut t = TestRepo::new();
    t.write("conflict.txt", "base\n");
    let base = t.commit_all("base");
    t.checkout_branch("other", base);
    let other = t.commit_on("other", "conflict.txt", "other side\n", "other change");
    t.commit_on("main", "conflict.txt", "main side\n", "main change");
    (t, other)
}

// ---------------------------------------------------------------- dispatch

#[test]
fn unknown_and_network_commands_are_unsupported() {
    let t = TestRepo::new();
    for args in [
        &["fetch", "origin"][..],
        &["push"],
        &["pull"],
        &["clone", "x", "y"],
        &["ls-remote", "origin"],
        &["submodule", "update"],
        &["rebase", "main"],
        &["worktree", "list", "--porcelain"],
        &["log", "--follow", "--", "a.txt"],
        &["frobnicate"],
    ] {
        let out = sh(&t, args);
        assert_eq!(out.code, 1, "{args:?}");
        assert!(
            out.stderr
                .starts_with("error: unsupported on this platform: git "),
            "{args:?}: {}",
            out.stderr
        );
        let err = out.into_result().unwrap_err();
        assert_eq!(err.kind, ErrorKind::Unsupported, "{args:?}");
    }
}

#[test]
fn unsupported_flags_of_supported_commands() {
    let t = TestRepo::new();
    let out = sh(&t, &["switch", "--orphan", "x"]);
    assert_eq!(out.into_result().unwrap_err().kind, ErrorKind::Unsupported);
    let out = sh(&t, &["add", "-p"]);
    assert_eq!(out.into_result().unwrap_err().kind, ErrorKind::Unsupported);
}

#[test]
fn global_options_are_accepted() {
    let t = TestRepo::new();
    let out = sh(
        &t,
        &["-c", "core.quotepath=false", "--no-pager", "--version"],
    );
    assert_eq!(out.code, 0);
    assert!(out.stdout_str().starts_with("git version"));
}

#[test]
fn outside_a_repository_is_fatal_128() {
    let dir = tempfile::tempdir().unwrap();
    let out = GitCli::embedded_for_tests()
        .run_raw(dir.path(), &["add", "--", "x"], &CliOptions::default())
        .unwrap();
    assert_eq!(out.code, 128);
    assert!(out.stderr.starts_with("fatal: not a git repository"));
}

#[test]
fn stderr_lines_are_streamed() {
    let t = TestRepo::new();
    let mut lines = Vec::new();
    GitCli::embedded_for_tests()
        .run_streaming(
            &t.root(),
            &["frobnicate"],
            &CliOptions::default(),
            None,
            &mut |l| lines.push(l.to_string()),
        )
        .unwrap();
    assert_eq!(lines.len(), 1);
}

// ------------------------------------------------------------- add / rm

#[test]
fn add_stages_a_file_and_a_deletion() {
    let mut t = TestRepo::new();
    t.write("a.txt", "a\n");
    t.write("b.txt", "b\n");
    t.commit_all("base");
    t.write("a.txt", "a2\n");
    t.write("new.txt", "n\n");
    fs::remove_file(t.root().join("b.txt")).unwrap();
    sh_ok(&t, &["add", "--", "a.txt"]);
    sh_ok(&t, &["add", "--", "new.txt"]);
    sh_ok(&t, &["add", "--", "b.txt"]);
    let index = idx(&t);
    assert!(index.get_path(std::path::Path::new("new.txt"), 0).is_some());
    assert!(index.get_path(std::path::Path::new("b.txt"), 0).is_none());
    let blob = t
        .repo
        .find_blob(index.get_path(std::path::Path::new("a.txt"), 0).unwrap().id)
        .unwrap();
    assert_eq!(blob.content(), b"a2\n");
}

#[test]
fn add_unknown_path_is_fatal() {
    let t = TestRepo::new();
    let out = sh(&t, &["add", "--", "nope.txt"]);
    assert_eq!(out.code, 128);
    assert!(out.stderr.contains("did not match any files"));
}

#[test]
fn add_resolves_a_conflicted_path() {
    let t = fixtures::conflicted_merge();
    assert!(idx(&t).has_conflicts());
    t.write("conflict.txt", "resolved\n");
    sh_ok(&t, &["add", "--", "conflict.txt"]);
    assert!(!idx(&t).has_conflicts());
}

#[test]
fn rm_resolves_a_conflict_by_deleting() {
    let t = fixtures::conflicted_merge();
    sh_ok(&t, &["rm", "--quiet", "-f", "--", "conflict.txt"]);
    assert!(!idx(&t).has_conflicts());
    assert!(!t.root().join("conflict.txt").exists());
}

#[test]
fn rm_cached_keeps_the_file() {
    let mut t = TestRepo::new();
    t.write("k.txt", "k\n");
    t.commit_all("base");
    sh_ok(&t, &["rm", "--cached", "--", "k.txt"]);
    assert!(t.root().join("k.txt").exists());
    assert!(idx(&t).get_path(std::path::Path::new("k.txt"), 0).is_none());
}

// --------------------------------------------------------------- switch

#[test]
fn switch_moves_head_and_worktree() {
    let (t, _) = diverged();
    let out = sh_ok(&t, &["switch", "topic"]);
    assert!(out.stderr.contains("Switched to branch 'topic'"));
    assert_eq!(t.repo.head().unwrap().shorthand().unwrap(), "topic");
    assert!(t.root().join("topic.txt").exists());
    assert!(!t.root().join("main.txt").exists());
    let out = sh_ok(&t, &["switch", "topic"]);
    assert!(out.stderr.contains("Already on 'topic'"));
}

#[test]
fn switch_unknown_branch_is_fatal() {
    let (t, _) = diverged();
    let out = sh(&t, &["switch", "nope"]);
    assert_eq!(out.code, 128);
    assert!(out.stderr.contains("invalid reference: nope"));
}

#[test]
fn switch_refuses_conflicting_local_changes() {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    let base = t.commit_all("base");
    t.checkout_branch("other", base);
    t.commit_on("other", "f.txt", "other\n", "other edit");
    t.commit_on("main", "f.txt", "1\n", "noop-ish");
    // `main` == base content; local edit collides with `other`'s change.
    t.write("f.txt", "local\n");
    let out = sh(&t, &["switch", "other"]);
    assert_eq!(out.code, 1, "{}", out.stderr);
    assert!(out.stderr.contains("would be overwritten by checkout"));
    assert!(out.stderr.contains("f.txt"));
    assert_eq!(t.repo.head().unwrap().shorthand().unwrap(), "main");
    assert_eq!(read(&t, "f.txt"), "local\n");
}

#[test]
fn switch_create_and_detach() {
    let (t, topic) = diverged();
    sh_ok(&t, &["switch", "-c", "feature"]);
    assert_eq!(t.repo.head().unwrap().shorthand().unwrap(), "feature");
    sh_ok(&t, &["switch", "--detach", &topic.to_string()]);
    assert!(t.repo.head_detached().unwrap());
    assert_eq!(t.head(), topic);
}

// ---------------------------------------------------------------- reset

#[test]
fn reset_merge_aborts_a_conflicted_merge_keeping_unrelated_edits() {
    let mut t = TestRepo::new();
    t.write("conflict.txt", "base\n");
    t.write("keep.txt", "keep\n");
    let base = t.commit_all("base");
    t.checkout_branch("other", base);
    let other = t.commit_on("other", "conflict.txt", "other side\n", "other change");
    t.commit_on("main", "conflict.txt", "main side\n", "main change");
    t.write("keep.txt", "edited locally\n");
    let annotated = t.repo.find_annotated_commit(other).unwrap();
    t.repo.merge(&[&annotated], None, None).unwrap();
    assert!(idx(&t).has_conflicts());
    sh_ok(&t, &["reset", "--merge"]);
    assert!(!idx(&t).has_conflicts());
    assert_eq!(read(&t, "conflict.txt"), "main side\n");
    assert_eq!(read(&t, "keep.txt"), "edited locally\n");
    assert_eq!(t.repo.state(), git2::RepositoryState::Clean);
}

#[test]
fn reset_hard_and_soft() {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    let first = t.commit_all("first");
    t.write("f.txt", "2\n");
    t.commit_all("second");
    sh_ok(&t, &["reset", "--soft", &first.to_string()]);
    assert_eq!(t.head(), first);
    assert_eq!(read(&t, "f.txt"), "2\n");
    sh_ok(&t, &["reset", "--hard", &first.to_string()]);
    assert_eq!(read(&t, "f.txt"), "1\n");
    let out = sh(&t, &["reset", "--hard", "nope"]);
    assert_eq!(out.code, 128);
}
