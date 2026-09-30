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
        &["rebase", "-i", "main"],
        &["worktree", "prune"],
        &["log", "--graph"],
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

// --------------------------------------------------------------- commit

#[test]
fn commit_from_stdin_uses_index_and_head() {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    let first = t.commit_all("first");
    t.write("f.txt", "2\n");
    t.write("untracked.txt", "u\n");
    sh_ok(&t, &["add", "--", "f.txt"]);
    let out = sh_in(
        &t,
        &["commit", "-F", "-", "--no-verify"],
        &stdin("second  \n\n\n\nbody line\n\n"),
    );
    assert_eq!(out.code, 0, "{}", out.stderr);
    assert!(out.stdout_str().contains("] second"));
    let c = t.repo.find_commit(t.head()).unwrap();
    assert_eq!(c.message().unwrap(), "second\n\nbody line\n");
    assert_eq!(c.parent_id(0).unwrap(), first);
    assert_eq!(c.author().name().unwrap(), "Fixture");
    // Only the staged file is in the tree.
    let tree = c.tree().unwrap();
    assert!(tree.get_name("untracked.txt").is_none());
    assert!(tree.get_name("f.txt").is_some());
}

#[test]
fn commit_root_commit_on_unborn_branch() {
    let t = TestRepo::new();
    t.write("f.txt", "1\n");
    sh_ok(&t, &["add", "--", "f.txt"]);
    let out = sh_in(&t, &["commit", "-F", "-"], &stdin("root\n"));
    assert_eq!(out.code, 0, "{}", out.stderr);
    assert!(out.stdout_str().contains("(root-commit)"));
    assert_eq!(t.repo.find_commit(t.head()).unwrap().parent_count(), 0);
}

#[test]
fn commit_with_nothing_staged_reports_nothing_to_commit() {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    t.commit_all("first");
    let out = sh_in(&t, &["commit", "-F", "-"], &stdin("again\n"));
    assert_eq!(out.code, 1);
    assert!(out.stdout_str().contains("nothing to commit"));
    t.write("f.txt", "unstaged\n");
    let out = sh_in(&t, &["commit", "-F", "-"], &stdin("again\n"));
    assert!(out.stdout_str().contains("no changes added to commit"));
    let out = sh_in(
        &t,
        &["commit", "-F", "-", "--allow-empty"],
        &stdin("empty\n"),
    );
    assert_eq!(out.code, 0);
}

#[test]
fn commit_amend_keeps_author_and_parents() {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    let first = t.commit_all("first");
    t.write("f.txt", "2\n");
    let second = t.commit_all_by("Original Author", "orig@example.com", "second");
    t.write("f.txt", "3\n");
    sh_ok(&t, &["add", "--", "f.txt"]);
    let out = sh_in(
        &t,
        &["commit", "-F", "-", "--amend"],
        &stdin("second, fixed\n"),
    );
    assert_eq!(out.code, 0, "{}", out.stderr);
    let c = t.repo.find_commit(t.head()).unwrap();
    assert_ne!(c.id(), second);
    assert_eq!(c.parent_id(0).unwrap(), first);
    assert_eq!(c.author().name().unwrap(), "Original Author");
    assert_eq!(c.committer().name().unwrap(), "Fixture");
    assert_eq!(c.message().unwrap(), "second, fixed\n");
    assert_eq!(read(&t, "f.txt"), "3\n");
}

#[test]
fn commit_signoff_and_empty_message() {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    t.commit_all("first");
    t.write("f.txt", "2\n");
    sh_ok(&t, &["add", "--", "f.txt"]);
    let out = sh_in(&t, &["commit", "-F", "-"], &stdin("  \n\n"));
    assert_eq!(out.code, 1);
    sh_in(&t, &["commit", "-F", "-", "--signoff"], &stdin("signed\n"));
    let msg = t
        .repo
        .find_commit(t.head())
        .unwrap()
        .message()
        .unwrap()
        .to_string();
    assert_eq!(
        msg,
        "signed\n\nSigned-off-by: Fixture <fixture@example.com>\n"
    );
}

#[test]
fn commit_gpgsign_warns_and_commits_unsigned() {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    t.commit_all("first");
    t.write("f.txt", "2\n");
    sh_ok(&t, &["add", "--", "f.txt"]);
    t.repo
        .config()
        .unwrap()
        .set_bool("commit.gpgsign", true)
        .unwrap();
    let out = sh_in(&t, &["commit", "-F", "-"], &stdin("x\n"));
    assert_eq!(out.code, 0);
    assert!(out.stderr.contains("commit.gpgsign"));
    assert!(t.repo.extract_signature(&t.head(), None).is_err());
}

#[test]
fn commit_without_identity_is_fatal() {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    t.commit_all("first");
    t.write("f.txt", "2\n");
    sh_ok(&t, &["add", "--", "f.txt"]);
    // `-c` with an empty value hides any host-level identity.
    let out = sh_in(
        &t,
        &["-c", "user.name=", "-c", "user.email=", "commit", "-F", "-"],
        &stdin("x\n"),
    );
    assert_eq!(out.code, 128);
    assert!(out.stderr.contains("Author identity unknown"));
}

#[test]
fn commit_refuses_unmerged_files() {
    let t = fixtures::conflicted_merge();
    let out = sh_in(&t, &["commit", "-F", "-"], &stdin("m\n"));
    assert_eq!(out.code, 128);
    assert!(out.stderr.contains("unmerged files"));
}

#[test]
fn commit_no_edit_concludes_a_merge() {
    let t = fixtures::conflicted_merge();
    let main = t.head();
    t.write("conflict.txt", "resolved\n");
    sh_ok(&t, &["add", "--", "conflict.txt"]);
    sh_ok(&t, &["commit", "--no-edit"]);
    let c = t.repo.find_commit(t.head()).unwrap();
    assert_eq!(c.parent_count(), 2);
    assert_eq!(c.parent_id(0).unwrap(), main);
    assert!(c.message().unwrap().starts_with("Merge"));
    assert!(!c.message().unwrap().contains("Conflicts"));
    assert_eq!(t.repo.state(), git2::RepositoryState::Clean);
}

// ---------------------------------------------------------------- stash

fn stash_list(t: &TestRepo) -> Vec<String> {
    let mut repo = git2::Repository::open(t.root()).unwrap();
    let mut v = Vec::new();
    repo.stash_foreach(|_, m, _| {
        v.push(m.to_string());
        true
    })
    .unwrap();
    v
}

#[test]
fn stash_push_apply_pop_drop_roundtrip() {
    let mut t = TestRepo::new();
    t.write("s.txt", "clean\n");
    t.commit_all("base");
    t.write("s.txt", "dirty\n");
    let out = sh_ok(&t, &["stash", "push", "-m", "my stash"]);
    assert!(out.stdout_str().contains("Saved working directory"));
    assert_eq!(read(&t, "s.txt"), "clean\n");
    assert_eq!(stash_list(&t), vec!["On main: my stash".to_string()]);

    sh_ok(&t, &["stash", "apply", "stash@{0}"]);
    assert_eq!(read(&t, "s.txt"), "dirty\n");
    assert_eq!(stash_list(&t).len(), 1);
    t.write("s.txt", "clean\n");
    let out = sh_ok(&t, &["stash", "pop", "stash@{0}"]);
    assert!(out.stdout_str().contains("Dropped"));
    assert_eq!(read(&t, "s.txt"), "dirty\n");
    assert!(stash_list(&t).is_empty());

    sh_ok(&t, &["stash", "push"]);
    assert_eq!(stash_list(&t).len(), 1);
    sh_ok(&t, &["stash", "drop", "stash@{0}"]);
    assert!(stash_list(&t).is_empty());
}

#[test]
fn stash_push_untracked_and_keep_index() {
    let mut t = TestRepo::new();
    t.write("a.txt", "a\n");
    t.commit_all("base");
    t.write("a.txt", "a2\n");
    t.write("new.txt", "n\n");
    sh_ok(&t, &["add", "--", "a.txt"]);
    sh_ok(
        &t,
        &["stash", "push", "--include-untracked", "--keep-index"],
    );
    assert!(!t.root().join("new.txt").exists());
    assert_eq!(read(&t, "a.txt"), "a2\n");
    // libgit2 refuses to apply onto a dirty index, so clean up first.
    sh_ok(&t, &["reset", "--hard"]);
    sh_ok(&t, &["stash", "pop", "stash@{0}"]);
    assert_eq!(read(&t, "new.txt"), "n\n");
}

#[test]
fn stash_push_with_nothing_to_save_succeeds() {
    let mut t = TestRepo::new();
    t.write("a.txt", "a\n");
    t.commit_all("base");
    let out = sh_ok(&t, &["stash", "push"]);
    assert!(out.stdout_str().contains("No local changes to save"));
    assert!(stash_list(&t).is_empty());
}

#[test]
fn stash_apply_conflict_exits_1_and_keeps_the_stash() {
    let mut t = TestRepo::new();
    t.write("s.txt", "base\n");
    t.commit_all("base");
    t.write("s.txt", "stashed\n");
    sh_ok(&t, &["stash", "push"]);
    t.write("s.txt", "committed\n");
    t.commit_all("diverge");
    let out = sh(&t, &["stash", "pop", "stash@{0}"]);
    assert_eq!(out.code, 1, "{}", out.stderr);
    assert!(out
        .stderr
        .contains("CONFLICT (content): Merge conflict in s.txt"));
    assert!(out.stderr.contains("stash entry is kept"));
    assert_eq!(stash_list(&t).len(), 1);
    assert!(idx(&t).has_conflicts());
}

#[test]
fn stash_apply_over_dirty_worktree_is_refused() {
    let mut t = TestRepo::new();
    t.write("s.txt", "base\n");
    t.commit_all("base");
    t.write("s.txt", "stashed\n");
    sh_ok(&t, &["stash", "push"]);
    t.write("s.txt", "local edit\n");
    let out = sh(&t, &["stash", "apply", "stash@{0}"]);
    assert_eq!(out.code, 1, "{}", out.stderr);
    assert!(out.stderr.contains("would be overwritten"));
    assert_eq!(read(&t, "s.txt"), "local edit\n");
    assert_eq!(stash_list(&t).len(), 1);
}

#[test]
fn stash_bad_index_and_unsupported_subcommand() {
    let t = TestRepo::new();
    let out = sh(&t, &["stash", "drop", "stash@{3}"]);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("not a valid reference"));
    let out = sh(&t, &["stash", "show"]);
    assert_eq!(out.into_result().unwrap_err().kind, ErrorKind::Unsupported);
}

#[test]
fn stash_store_restores_a_dropped_stash() {
    let mut t = TestRepo::new();
    t.write("s.txt", "clean\n");
    t.commit_all("base");
    t.write("s.txt", "dirty\n");
    sh_ok(&t, &["stash", "push", "-m", "keep me"]);
    let oid = git2::Repository::open(t.root())
        .unwrap()
        .revparse_single("refs/stash")
        .unwrap()
        .id();
    sh_ok(&t, &["stash", "drop", "stash@{0}"]);
    assert!(stash_list(&t).is_empty());
    sh_ok(
        &t,
        &["stash", "store", "-m", "On main: keep me", &oid.to_string()],
    );
    assert_eq!(stash_list(&t), vec!["On main: keep me".to_string()]);
    sh_ok(&t, &["stash", "pop", "stash@{0}"]);
    assert_eq!(read(&t, "s.txt"), "dirty\n");
}

// ---------------------------------------------------------------- merge

fn state(t: &TestRepo) -> git2::RepositoryState {
    git2::Repository::open(t.root()).unwrap().state()
}

fn subjects(t: &TestRepo) -> Vec<String> {
    let repo = git2::Repository::open(t.root()).unwrap();
    let mut walk = repo.revwalk().unwrap();
    walk.push_head().unwrap();
    walk.map(|o| {
        repo.find_commit(o.unwrap())
            .unwrap()
            .summary()
            .unwrap()
            .unwrap()
            .to_string()
    })
    .collect()
}

/// `main` at `base`, `topic` two commits ahead (fast-forwardable).
fn ahead() -> (TestRepo, git2::Oid) {
    let mut t = TestRepo::new();
    t.write("base.txt", "base\n");
    let base = t.commit_all("base");
    t.checkout_branch("topic", base);
    t.commit_on("topic", "t1.txt", "1\n", "topic 1");
    let tip = t.commit_on("topic", "t2.txt", "2\n", "topic 2");
    t.repo.set_head("refs/heads/main").unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    (t, tip)
}

#[test]
fn merge_fast_forwards() {
    let (t, tip) = ahead();
    let out = sh_ok(
        &t,
        &["merge", "--no-edit", "--ff-only", "--", &tip.to_string()],
    );
    assert!(out.stdout_str().contains("Fast-forward"));
    assert_eq!(t.branch_tip("main"), tip);
    assert!(t.root().join("t2.txt").exists());
    assert_eq!(state(&t), git2::RepositoryState::Clean);
}

#[test]
fn merge_ff_only_refuses_diverged_branches() {
    let (t, topic) = diverged();
    let main = t.head();
    let out = sh(&t, &["merge", "--no-edit", "--ff-only", &topic.to_string()]);
    assert_eq!(out.code, 128);
    assert!(out
        .stderr
        .contains("Not possible to fast-forward, aborting."));
    assert_eq!(t.head(), main);
}

#[test]
fn merge_creates_a_merge_commit_with_the_given_message() {
    let (t, topic) = diverged();
    let main = t.head();
    let out = sh_ok(
        &t,
        &[
            "merge",
            "--no-edit",
            "-m",
            "Merge the topic",
            &topic.to_string(),
        ],
    );
    assert!(out.stdout_str().contains("Merge made by"));
    let c = t.repo.find_commit(t.head()).unwrap();
    assert_eq!(c.message().unwrap(), "Merge the topic\n");
    assert_eq!(c.parent_id(0).unwrap(), main);
    assert_eq!(c.parent_id(1).unwrap(), topic);
    assert!(t.root().join("topic.txt").exists() && t.root().join("main.txt").exists());
    assert_eq!(state(&t), git2::RepositoryState::Clean);
}

#[test]
fn merge_default_message_names_the_branch() {
    let (t, _) = diverged();
    sh_ok(&t, &["merge", "--no-edit", "--", "topic"]);
    assert_eq!(subjects(&t)[0], "Merge branch 'topic'");
}

#[test]
fn merge_no_ff_forces_a_merge_commit() {
    let (t, tip) = ahead();
    sh_ok(
        &t,
        &[
            "merge",
            "--no-edit",
            "--no-ff",
            "-m",
            "forced",
            &tip.to_string(),
        ],
    );
    let c = t.repo.find_commit(t.head()).unwrap();
    assert_eq!(c.parent_count(), 2);
    assert_eq!(c.message().unwrap(), "forced\n");
}

#[test]
fn merge_up_to_date_and_bad_revision() {
    let (t, _) = diverged();
    let head = t.head().to_string();
    let out = sh_ok(&t, &["merge", "--no-edit", &head]);
    assert!(out.stdout_str().contains("Already up to date."));
    let out = sh(&t, &["merge", "--no-edit", "nope"]);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("not something we can merge"));
}

#[test]
fn merge_conflict_leaves_state_then_abort_restores() {
    let (t, other) = conflicting();
    let main = t.head();
    let out = sh(&t, &["merge", "--no-edit", &other.to_string()]);
    assert_eq!(out.code, 1, "{}", out.stderr);
    let text = out.stdout_str();
    assert!(text.contains("CONFLICT (content): Merge conflict in conflict.txt"));
    assert!(text.contains("Automatic merge failed; fix conflicts and then commit the result."));
    assert_eq!(state(&t), git2::RepositoryState::Merge);
    assert!(t.root().join(".git/MERGE_HEAD").exists());
    assert!(t.root().join(".git/MERGE_MSG").exists());
    assert!(idx(&t).has_conflicts());
    assert!(read(&t, "conflict.txt").contains("<<<<<<<"));

    sh_ok(&t, &["merge", "--abort"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert_eq!(read(&t, "conflict.txt"), "main side\n");
    assert!(!idx(&t).has_conflicts());
    assert_eq!(t.head(), main);
    let out = sh(&t, &["merge", "--abort"]);
    assert_eq!(out.code, 128);
}

#[test]
fn merge_conflict_resolved_and_concluded() {
    let (t, other) = conflicting();
    sh(&t, &["merge", "--no-edit", &other.to_string()]);
    // A second merge while one is unfinished is refused.
    let out = sh(&t, &["merge", "--no-edit", &other.to_string()]);
    assert_eq!(out.code, 128);
    t.write("conflict.txt", "both\n");
    sh_ok(&t, &["add", "--", "conflict.txt"]);
    sh_ok(&t, &["commit", "--no-edit"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert_eq!(t.repo.find_commit(t.head()).unwrap().parent_count(), 2);
}

#[test]
fn merge_refuses_to_overwrite_local_changes() {
    let mut t = TestRepo::new();
    t.write("f.txt", "base\n");
    let base = t.commit_all("base");
    t.checkout_branch("topic", base);
    let topic = t.commit_on("topic", "f.txt", "topic\n", "topic edit");
    t.commit_on("main", "other.txt", "o\n", "main change");
    t.write("f.txt", "local\n");
    let out = sh(&t, &["merge", "--no-edit", &topic.to_string()]);
    assert_eq!(out.code, 1, "{}", out.stderr);
    assert!(out.stderr.contains("would be overwritten"));
    assert!(!t.root().join(".git/MERGE_HEAD").exists());
    assert_eq!(read(&t, "f.txt"), "local\n");
}

#[test]
fn merge_squash_stages_without_committing() {
    let (t, topic) = diverged();
    let main = t.head();
    sh_ok(
        &t,
        &["merge", "--no-edit", "--squash", "--", &topic.to_string()],
    );
    assert_eq!(t.head(), main);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert!(t.root().join("topic.txt").exists());
    assert!(!t.root().join(".git/MERGE_HEAD").exists());
    assert!(t.root().join(".git/SQUASH_MSG").exists());
    assert!(idx(&t)
        .get_path(std::path::Path::new("topic.txt"), 0)
        .is_some());
}

// ---------------------------------------------------------- cherry-pick

/// `main` has edited `f.txt`; `other` has c1 (a.txt), c2 (f.txt, conflicts
/// with main) and c3 (b.txt).
fn pick_setup() -> (TestRepo, [git2::Oid; 3]) {
    let mut t = TestRepo::new();
    t.write("f.txt", "base\n");
    let base = t.commit_all("base");
    t.checkout_branch("other", base);
    let c1 = t.commit_on("other", "a.txt", "a\n", "add a");
    let c2 = t.commit_on("other", "f.txt", "other\n", "edit f on other");
    let c3 = t.commit_on("other", "b.txt", "b\n", "add b");
    t.commit_on("main", "f.txt", "main\n", "edit f on main");
    (t, [c1, c2, c3])
}

#[test]
fn cherry_pick_applies_and_keeps_the_author() {
    let mut t = TestRepo::new();
    t.write("f.txt", "base\n");
    let base = t.commit_all("base");
    t.checkout_branch("other", base);
    t.write("a.txt", "a\n");
    let c1 = t.commit_all_by("Picked Author", "pa@example.com", "add a\n\nbody");
    t.repo.set_head("refs/heads/main").unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    let main = t.head();
    sh_ok(&t, &["cherry-pick", &c1.to_string()]);
    let c = t.repo.find_commit(t.head()).unwrap();
    assert_eq!(c.parent_id(0).unwrap(), main);
    assert_eq!(c.author().name().unwrap(), "Picked Author");
    assert_eq!(c.committer().name().unwrap(), "Fixture");
    assert_eq!(c.message().unwrap(), "add a\n\nbody");
    assert_eq!(read(&t, "a.txt"), "a\n");
    assert_eq!(state(&t), git2::RepositoryState::Clean);
}

#[test]
fn cherry_pick_several_commits_in_order() {
    let (t, [c1, _, c3]) = pick_setup();
    sh_ok(&t, &["cherry-pick", &c1.to_string(), &c3.to_string()]);
    assert_eq!(
        subjects(&t)[..2],
        ["add b".to_string(), "add a".to_string()]
    );
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert!(!t.root().join(".git/sequencer").exists());
}

#[test]
fn cherry_pick_conflict_then_continue() {
    let (t, [_, c2, _]) = pick_setup();
    let out = sh(&t, &["cherry-pick", &c2.to_string()]);
    assert_eq!(out.code, 1, "{}", out.stderr);
    assert!(out
        .stdout_str()
        .contains("CONFLICT (content): Merge conflict in f.txt"));
    assert!(out.stderr.contains("could not apply"));
    assert_eq!(state(&t), git2::RepositoryState::CherryPick);
    assert!(t.root().join(".git/CHERRY_PICK_HEAD").exists());

    // Unresolved: refuse.
    let out = sh(&t, &["cherry-pick", "--continue"]);
    assert_eq!(out.code, 128);
    t.write("f.txt", "resolved\n");
    sh_ok(&t, &["add", "--", "f.txt"]);
    sh_ok(&t, &["cherry-pick", "--continue"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    let c = t.repo.find_commit(t.head()).unwrap();
    assert_eq!(c.summary().unwrap().unwrap(), "edit f on other");
    assert_eq!(read(&t, "f.txt"), "resolved\n");
}

#[test]
fn cherry_pick_conflict_then_abort() {
    let (t, [_, c2, _]) = pick_setup();
    let main = t.head();
    sh(&t, &["cherry-pick", &c2.to_string()]);
    sh_ok(&t, &["cherry-pick", "--abort"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert_eq!(t.head(), main);
    assert_eq!(read(&t, "f.txt"), "main\n");
    assert!(!idx(&t).has_conflicts());
    let out = sh(&t, &["cherry-pick", "--abort"]);
    assert_eq!(out.code, 128);
}

#[test]
fn cherry_pick_conflict_then_skip() {
    let (t, [_, c2, _]) = pick_setup();
    let main = t.head();
    sh(&t, &["cherry-pick", &c2.to_string()]);
    sh_ok(&t, &["cherry-pick", "--skip"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert_eq!(t.head(), main);
    assert_eq!(read(&t, "f.txt"), "main\n");
}

#[test]
fn cherry_pick_sequence_reports_sequence_state() {
    let (t, [c1, c2, c3]) = pick_setup();
    let main = t.head();
    let out = sh(
        &t,
        &[
            "cherry-pick",
            &c1.to_string(),
            &c2.to_string(),
            &c3.to_string(),
        ],
    );
    assert_eq!(out.code, 1, "{}", out.stderr);
    assert_eq!(state(&t), git2::RepositoryState::CherryPickSequence);
    let todo = fs::read_to_string(t.root().join(".git/sequencer/todo")).unwrap();
    assert_eq!(todo.lines().count(), 2);
    assert!(todo.starts_with("pick "));
    assert_eq!(subjects(&t)[0], "add a");

    t.write("f.txt", "resolved\n");
    sh_ok(&t, &["add", "--", "f.txt"]);
    sh_ok(&t, &["cherry-pick", "--continue"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert_eq!(
        subjects(&t)[..3],
        [
            "add b".to_string(),
            "edit f on other".to_string(),
            "add a".to_string()
        ]
    );
    assert!(!t.root().join(".git/sequencer").exists());

    // Same sequence again, aborted: HEAD returns to where it started.
    sh_ok(&t, &["reset", "--hard", &main.to_string()]);
    sh(
        &t,
        &[
            "cherry-pick",
            &c1.to_string(),
            &c2.to_string(),
            &c3.to_string(),
        ],
    );
    assert_eq!(state(&t), git2::RepositoryState::CherryPickSequence);
    sh_ok(&t, &["cherry-pick", "--abort"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert_eq!(t.head(), main);
    assert!(!t.root().join("a.txt").exists());
}

#[test]
fn cherry_pick_sequence_skip_continues_with_the_rest() {
    let (t, [c1, c2, c3]) = pick_setup();
    sh(
        &t,
        &[
            "cherry-pick",
            &c1.to_string(),
            &c2.to_string(),
            &c3.to_string(),
        ],
    );
    sh_ok(&t, &["cherry-pick", "--skip"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert_eq!(
        subjects(&t)[..2],
        ["add b".to_string(), "add a".to_string()]
    );
    assert_eq!(read(&t, "f.txt"), "main\n");
}

#[test]
fn cherry_pick_no_commit_stages_only() {
    let (t, [c1, _, _]) = pick_setup();
    let main = t.head();
    sh_ok(&t, &["cherry-pick", "-n", &c1.to_string()]);
    assert_eq!(t.head(), main);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert!(idx(&t).get_path(std::path::Path::new("a.txt"), 0).is_some());
}

#[test]
fn cherry_pick_rejects_merge_commit_without_mainline_and_bad_revision() {
    let (t, topic) = diverged();
    sh_ok(&t, &["merge", "--no-edit", "-m", "m", &topic.to_string()]);
    let merge = t.head().to_string();
    sh_ok(&t, &["reset", "--hard", "HEAD~1"]);
    let out = sh(&t, &["cherry-pick", &merge]);
    assert_eq!(out.code, 128);
    assert!(out.stderr.contains("is a merge but no -m option was given"));
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    let out = sh(&t, &["cherry-pick", "-m", "1", &merge]);
    assert_eq!(out.code, 0, "{}", out.stderr);
    let out = sh(&t, &["cherry-pick", "nope"]);
    assert_eq!(out.code, 128);
}

#[test]
fn cherry_pick_already_applied_stops_as_empty() {
    let (t, [c1, _, _]) = pick_setup();
    sh_ok(&t, &["cherry-pick", &c1.to_string()]);
    let out = sh(&t, &["cherry-pick", &c1.to_string()]);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("now empty"));
    assert_eq!(state(&t), git2::RepositoryState::CherryPick);
    sh_ok(&t, &["cherry-pick", "--skip"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
}

#[test]
fn cherry_pick_refuses_staged_changes_and_local_overlap() {
    let (t, [c1, c2, _]) = pick_setup();
    t.write("x.txt", "x\n");
    sh_ok(&t, &["add", "--", "x.txt"]);
    let out = sh(&t, &["cherry-pick", &c1.to_string()]);
    assert_eq!(out.code, 128);
    assert!(out.stderr.contains("would be overwritten"));
    sh_ok(&t, &["reset", "--hard"]);
    t.write("f.txt", "local\n");
    let out = sh(&t, &["cherry-pick", &c2.to_string()]);
    assert_eq!(out.code, 1, "{}", out.stderr);
    assert!(out.stderr.contains("would be overwritten"));
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert_eq!(read(&t, "f.txt"), "local\n");
}

// --------------------------------------------------------------- revert

#[test]
fn revert_creates_a_revert_commit() {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    t.commit_all("first");
    t.write("g.txt", "g\n");
    let second = t.commit_all("add g");
    let out = sh_ok(&t, &["revert", "--no-edit", &second.to_string()]);
    assert_eq!(out.code, 0);
    let c = t.repo.find_commit(t.head()).unwrap();
    assert_eq!(
        c.message().unwrap(),
        format!("Revert \"add g\"\n\nThis reverts commit {second}.\n")
    );
    assert!(!t.root().join("g.txt").exists());
    assert_eq!(state(&t), git2::RepositoryState::Clean);
}

#[test]
fn revert_conflict_continue_and_abort() {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    t.commit_all("first");
    t.write("f.txt", "2\n");
    let second = t.commit_all("second");
    t.write("f.txt", "3\n");
    let third = t.commit_all("third");
    let out = sh(&t, &["revert", "--no-edit", &second.to_string()]);
    assert_eq!(out.code, 1, "{}", out.stderr);
    assert_eq!(state(&t), git2::RepositoryState::Revert);
    sh_ok(&t, &["revert", "--abort"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert_eq!(t.head(), third);
    assert_eq!(read(&t, "f.txt"), "3\n");

    sh(&t, &["revert", "--no-edit", &second.to_string()]);
    t.write("f.txt", "resolved\n");
    sh_ok(&t, &["add", "--", "f.txt"]);
    sh_ok(&t, &["revert", "--continue"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    let c = t.repo.find_commit(t.head()).unwrap();
    assert!(c
        .summary()
        .unwrap()
        .unwrap()
        .starts_with("Revert \"second\""));
    assert!(!c.message().unwrap().contains('#'));
}

#[test]
fn revert_sequence_reports_sequence_state_and_skips() {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    t.commit_all("first");
    t.write("f.txt", "2\n");
    let second = t.commit_all("second");
    t.write("g.txt", "g\n");
    let third = t.commit_all("third");
    t.write("f.txt", "4\n");
    t.commit_all("fourth");
    // Newest first: third reverts cleanly, second conflicts with fourth.
    sh(
        &t,
        &[
            "revert",
            "--no-edit",
            &third.to_string(),
            &second.to_string(),
        ],
    );
    assert_eq!(state(&t), git2::RepositoryState::RevertSequence);
    sh_ok(&t, &["revert", "--skip"]);
    assert_eq!(state(&t), git2::RepositoryState::Clean);
    assert_eq!(subjects(&t)[0], "Revert \"third\"");
}

#[test]
fn control_flags_without_operation_are_fatal() {
    let (t, _) = diverged();
    for args in [
        &["cherry-pick", "--continue"][..],
        &["revert", "--abort"],
        &["cherry-pick", "--skip"],
    ] {
        let out = sh(&t, args);
        assert_eq!(out.code, 128, "{args:?}");
        assert!(out.stderr.contains("no cherry-pick or revert in progress"));
    }
}
