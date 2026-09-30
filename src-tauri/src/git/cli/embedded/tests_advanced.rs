//! Tests of the R1b-2 handlers: rebase, worktrees and `log --follow`.

use git2::{Oid, RepositoryState};

use super::super::tests::{conflicting, diverged, idx, read, sh, sh_ok};
use crate::git::fixtures::TestRepo;
use crate::ipc::error::ErrorKind;

fn state(t: &TestRepo) -> RepositoryState {
    git2::Repository::open(t.root()).unwrap().state()
}

fn subjects(t: &TestRepo, tip: &str) -> Vec<String> {
    let repo = git2::Repository::open(t.root()).unwrap();
    let mut walk = repo.revwalk().unwrap();
    walk.push(repo.revparse_single(tip).unwrap().id()).unwrap();
    walk.map(|o| {
        repo.find_commit(o.unwrap())
            .unwrap()
            .summary()
            .unwrap()
            .unwrap_or("")
            .to_string()
    })
    .collect()
}

// ------------------------------------------------------------------ rebase

#[test]
fn rebase_replays_and_keeps_author_and_committer_from_config() {
    let (t, topic) = diverged();
    let old = t.repo.find_commit(topic).unwrap();
    // Give the topic commit a distinct author.
    let main_tip = t.branch_tip("main");
    t.repo.set_head("refs/heads/topic").unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    assert_eq!(old.author().name().unwrap(), "Test User");
    let out = sh(&t, &["rebase", &main_tip.to_string()]);
    assert_eq!(out.code, 0, "{}", out.stderr);
    assert!(out.stderr.contains("Successfully rebased and updated"));
    assert_eq!(state(&t), RepositoryState::Clean);
    assert_eq!(
        subjects(&t, "topic"),
        ["topic change", "main change", "base"]
    );
    let new = t.repo.find_commit(t.branch_tip("topic")).unwrap();
    assert_ne!(new.id(), topic);
    assert_eq!(new.author().name().unwrap(), "Test User");
    assert_eq!(new.author().when().seconds(), old.author().when().seconds());
    assert_eq!(new.committer().name().unwrap(), "Fixture");
    assert!(t.root().join("main.txt").exists() && t.root().join("topic.txt").exists());
    assert!(!idx(&t).has_conflicts());
    // HEAD is the branch again, not detached.
    assert_eq!(
        t.repo
            .find_reference("HEAD")
            .unwrap()
            .symbolic_target()
            .unwrap(),
        Some("refs/heads/topic")
    );
}

#[test]
fn rebase_onto_a_branch_argument_checks_it_out() {
    let (t, _) = diverged();
    assert_eq!(state(&t), RepositoryState::Clean);
    let out = sh(&t, &["rebase", "main", "topic"]);
    assert_eq!(out.code, 0, "{}", out.stderr);
    assert_eq!(
        t.repo
            .find_reference("HEAD")
            .unwrap()
            .symbolic_target()
            .unwrap(),
        Some("refs/heads/topic")
    );
    assert_eq!(
        subjects(&t, "topic"),
        ["topic change", "main change", "base"]
    );
}

#[test]
fn rebase_up_to_date_and_fast_forward() {
    let (t, _) = diverged();
    // main is ahead of topic's base only through a divergence: first move
    // topic under main to get both cases.
    sh_ok(&t, &["rebase", "main", "topic"]);
    // HEAD (topic) already contains main.
    let out = sh_ok(&t, &["rebase", "main"]);
    assert_eq!(out.stdout_str(), "Current branch topic is up to date.\n");
    // main is behind topic: rebasing main onto topic fast-forwards it.
    let topic = t.branch_tip("topic");
    let out = sh(&t, &["rebase", &topic.to_string(), "main"]);
    assert_eq!(out.code, 0, "{}", out.stderr);
    assert_eq!(t.branch_tip("main"), topic);
    assert_eq!(state(&t), RepositoryState::Clean);
    assert!(t.root().join("topic.txt").exists());
}

#[test]
fn rebase_onto_replays_only_the_range() {
    let mut t = TestRepo::new();
    t.write("a.txt", "a\n");
    let a = t.commit_all("a");
    t.checkout_branch("feat", a);
    let b = t.commit_on("feat", "b.txt", "b\n", "b");
    t.commit_on("feat", "c.txt", "c\n", "c");
    t.checkout_branch("other", a);
    t.commit_on("other", "o.txt", "o\n", "o");
    t.repo.set_head("refs/heads/feat").unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    let out = sh(&t, &["rebase", "--onto", "other", &b.to_string()]);
    assert_eq!(out.code, 0, "{}", out.stderr);
    assert_eq!(subjects(&t, "feat"), ["c", "o", "a"]);
    assert!(!t.root().join("b.txt").exists());
}

#[test]
fn rebase_conflict_reports_lines_then_abort_restores() {
    let (t, _) = conflicting();
    t.repo.set_head("refs/heads/other").unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    let before = t.head();
    let out = sh(&t, &["rebase", "main"]);
    assert_eq!(out.code, 1, "{}", out.stderr);
    assert!(out
        .stdout_str()
        .contains("CONFLICT (content): Merge conflict in conflict.txt"));
    assert!(out.stderr.contains("could not apply"));
    assert_eq!(state(&t), RepositoryState::RebaseMerge);
    assert!(t.root().join(".git/REBASE_HEAD").exists());
    assert!(idx(&t).has_conflicts());

    // A second rebase while one is running is refused.
    assert_eq!(sh(&t, &["rebase", "main"]).code, 128);
    // Unresolved: --continue refuses.
    assert_eq!(sh(&t, &["rebase", "--continue"]).code, 1);

    sh_ok(&t, &["rebase", "--abort"]);
    assert_eq!(state(&t), RepositoryState::Clean);
    assert_eq!(t.branch_tip("other"), before);
    assert_eq!(read(&t, "conflict.txt"), "other side\n");
    assert!(!idx(&t).has_conflicts());
    assert!(!t.root().join(".git/REBASE_HEAD").exists());
    assert_eq!(sh(&t, &["rebase", "--abort"]).code, 128);
}

/// `main` and `other` both edit `f.txt`; `other` has a second, clean commit
/// after the conflicting one.
fn two_step() -> (TestRepo, Oid) {
    let mut t = TestRepo::new();
    t.write("f.txt", "base\n");
    let base = t.commit_all("base");
    t.checkout_branch("other", base);
    t.commit_on("other", "f.txt", "other side\n", "edit f on other");
    let second = t.commit_on("other", "g.txt", "g\n", "add g on other");
    t.commit_on("main", "f.txt", "main side\n", "edit f on main");
    t.repo.set_head("refs/heads/other").unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    (t, second)
}

#[test]
fn rebase_conflict_resolve_continue_runs_the_remaining_steps() {
    let (t, _) = two_step();
    let out = sh(&t, &["rebase", "main"]);
    assert_eq!(out.code, 1, "{}", out.stderr);
    t.write("f.txt", "resolved\n");
    sh_ok(&t, &["add", "--", "f.txt"]);
    let out = sh(&t, &["rebase", "--continue"]);
    assert_eq!(out.code, 0, "{}", out.stderr);
    assert_eq!(state(&t), RepositoryState::Clean);
    assert_eq!(
        subjects(&t, "other"),
        [
            "add g on other",
            "edit f on other",
            "edit f on main",
            "base"
        ]
    );
    assert_eq!(read(&t, "f.txt"), "resolved\n");
    assert_eq!(read(&t, "g.txt"), "g\n");
    let c = t.repo.find_commit(t.branch_tip("other")).unwrap();
    assert_eq!(c.author().name().unwrap(), "Test User");
    assert_eq!(c.committer().name().unwrap(), "Fixture");
}

#[test]
fn rebase_skip_drops_the_conflicting_commit_and_continues() {
    let (t, _) = two_step();
    assert_eq!(sh(&t, &["rebase", "main"]).code, 1);
    let out = sh(&t, &["rebase", "--skip"]);
    assert_eq!(out.code, 0, "{}", out.stderr);
    assert_eq!(state(&t), RepositoryState::Clean);
    assert_eq!(
        subjects(&t, "other"),
        ["add g on other", "edit f on main", "base"]
    );
    assert_eq!(read(&t, "f.txt"), "main side\n");
    assert!(!idx(&t).has_conflicts());
}

#[test]
fn rebase_drops_commits_already_upstream() {
    let mut t = TestRepo::new();
    t.write("a.txt", "a\n");
    let a = t.commit_all("a");
    t.checkout_branch("feat", a);
    t.commit_on("feat", "x.txt", "x\n", "add x");
    t.checkout_branch("main2", a);
    t.commit_on("main2", "x.txt", "x\n", "add x again");
    t.repo.set_head("refs/heads/feat").unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    let out = sh(&t, &["rebase", "main2"]);
    assert_eq!(out.code, 0, "{}", out.stderr);
    assert_eq!(subjects(&t, "feat"), ["add x again", "a"]);
}

#[test]
fn rebase_refuses_a_dirty_tree_and_bad_input() {
    let (t, _) = diverged();
    t.repo.set_head("refs/heads/topic").unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    t.write("topic.txt", "dirty\n");
    let out = sh(&t, &["rebase", "main"]);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("cannot rebase"));
    assert_eq!(read(&t, "topic.txt"), "dirty\n");
    assert_eq!(sh(&t, &["rebase", "nope"]).code, 128);
    assert_eq!(sh(&t, &["rebase", "--continue"]).code, 128);
    for args in [
        &["rebase", "-i", "main"][..],
        &["rebase", "--interactive", "main"],
        &["rebase", "--exec", "true", "main"],
        &["rebase", "--autosquash", "main"],
    ] {
        let out = sh(&t, args);
        assert_eq!(
            out.into_result().unwrap_err().kind,
            ErrorKind::Unsupported,
            "{args:?}"
        );
    }
}

// --------------------------------------------------------------- worktrees

fn real_git_available() -> bool {
    std::process::Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn real_porcelain(t: &TestRepo) -> String {
    let out = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(t.root())
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).replace("\r\n", "\n")
}

fn fwd(p: &std::path::Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

#[test]
fn worktree_list_porcelain_matches_git() {
    let (t, oids) = crate::git::fixtures::linear(2);
    let outside = tempfile::tempdir().unwrap();
    let a = fwd(&outside.path().join("wt-a"));
    let b = fwd(&outside.path().join("wt-b"));
    sh_ok(&t, &["worktree", "add", "-b", "feat/a", "--", &a]);
    sh_ok(
        &t,
        &[
            "worktree",
            "add",
            "-b",
            "feat/b",
            "--",
            &b,
            &oids[0].to_string(),
        ],
    );
    let out = sh_ok(&t, &["worktree", "list", "--porcelain"]).stdout_str();
    let root = fwd(&t.root());
    let head = oids[1];
    let expected = format!(
        "worktree {root}\nHEAD {head}\nbranch refs/heads/main\n\n\
         worktree {a}\nHEAD {head}\nbranch refs/heads/feat/a\n\n\
         worktree {b}\nHEAD {}\nbranch refs/heads/feat/b\n\n",
        oids[0]
    );
    assert_eq!(out, expected);
    if real_git_available() {
        assert_eq!(out, real_porcelain(&t));
    }
    // The human format lists the same worktrees.
    let plain = sh_ok(&t, &["worktree", "list"]).stdout_str();
    assert_eq!(plain.lines().count(), 3);
    assert!(plain.contains("[feat/a]"));
}

#[test]
fn worktree_add_variants_and_refusals() {
    let (t, _) = crate::git::fixtures::linear(1);
    let outside = tempfile::tempdir().unwrap();
    let p = |n: &str| fwd(&outside.path().join(n));
    // No -b and no commit-ish: a branch named after the directory.
    sh_ok(&t, &["worktree", "add", &p("auto")]);
    assert!(t.repo.find_branch("auto", git2::BranchType::Local).is_ok());
    // A branch that is already checked out elsewhere is refused.
    let out = sh(&t, &["worktree", "add", &p("dup"), "auto"]);
    assert_eq!(out.code, 128);
    assert!(out.stderr.contains("already checked out"), "{}", out.stderr);
    // -b on an existing branch is refused and creates nothing.
    let out = sh(&t, &["worktree", "add", "-b", "auto", &p("x")]);
    assert_eq!(out.code, 128);
    assert!(!outside.path().join("x").exists());
    // Non-empty target.
    std::fs::create_dir_all(outside.path().join("full")).unwrap();
    std::fs::write(outside.path().join("full/f"), "x").unwrap();
    assert_eq!(
        sh(&t, &["worktree", "add", "-b", "n", &p("full")]).code,
        128
    );
    assert!(t.repo.find_branch("n", git2::BranchType::Local).is_err());
    // Detached and other unsupported forms.
    for args in [
        &["worktree", "add", "--detach", &p("d")][..],
        &["worktree", "prune"],
        &["worktree", "lock", "x"],
    ] {
        assert_eq!(
            sh(&t, args).into_result().unwrap_err().kind,
            ErrorKind::Unsupported,
            "{args:?}"
        );
    }
}

#[test]
fn worktree_remove_rules_and_prunable_reporting() {
    let (t, _) = crate::git::fixtures::linear(1);
    let outside = tempfile::tempdir().unwrap();
    let wt = outside.path().join("wt");
    let path = fwd(&wt);
    sh_ok(&t, &["worktree", "add", "-b", "w", "--", &path]);
    // Main worktree and unknown paths are refused.
    assert_eq!(sh(&t, &["worktree", "remove", &fwd(&t.root())]).code, 128);
    assert_eq!(sh(&t, &["worktree", "remove", "nowhere"]).code, 128);
    // An untracked file blocks removal until --force.
    std::fs::write(wt.join("new.txt"), "x").unwrap();
    let out = sh(&t, &["worktree", "remove", "--", &path]);
    assert_eq!(out.code, 128);
    assert!(out.stderr.contains("--force"));
    assert!(wt.exists());
    // Deleting the directory makes it prunable in the listing.
    std::fs::remove_dir_all(&wt).unwrap();
    let listing = sh_ok(&t, &["worktree", "list", "--porcelain"]).stdout_str();
    assert!(listing.contains("prunable gitdir file points to non-existent location"));
    sh_ok(&t, &["worktree", "remove", "--force", "--", &path]);
    let listing = sh_ok(&t, &["worktree", "list", "--porcelain"]).stdout_str();
    assert_eq!(listing.matches("worktree ").count(), 1);
    // A clean worktree is removed without --force.
    sh_ok(&t, &["worktree", "add", "-b", "w2", "--", &path]);
    sh_ok(&t, &["worktree", "remove", "--", &path]);
    assert!(!wt.exists());
}

// ------------------------------------------------------------ log --follow

const RS: &str = "\u{1e}";
const US: &str = "\u{1f}";

fn follow_args(path: &str, limit: usize) -> Vec<String> {
    vec![
        "log".into(),
        "--follow".into(),
        "--no-color".into(),
        format!("-n{limit}"),
        "--name-status".into(),
        format!("--format={RS}%H{US}%an{US}%at{US}%s"),
        "--".into(),
        path.into(),
    ]
}

fn shim_log(t: &TestRepo, path: &str, limit: usize) -> String {
    let a = follow_args(path, limit);
    let refs: Vec<&str> = a.iter().map(String::as_str).collect();
    sh_ok(t, &refs).stdout_str()
}

fn real_log(t: &TestRepo, path: &str, limit: usize) -> String {
    let out = std::process::Command::new("git")
        .args(follow_args(path, limit))
        .current_dir(t.root())
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).replace("\r\n", "\n")
}

/// Records of a log as `(oid, name-status line)`; whitespace between the
/// records differs between git versions and is not part of the contract.
fn records(text: &str) -> Vec<(String, String)> {
    text.split(RS)
        .filter(|r| !r.trim().is_empty())
        .map(|r| {
            let mut lines = r.lines();
            let head = lines.next().unwrap();
            let status = lines.find(|l| !l.trim().is_empty()).unwrap_or("");
            (head.to_string(), status.to_string())
        })
        .collect()
}

#[test]
fn log_follow_renames_deletes_and_limit() {
    let mut t = TestRepo::new();
    let body: String = (0..20).map(|i| format!("line number {i}\n")).collect();
    t.write("a.txt", &body);
    let c1 = t.commit_all("add a");
    t.remove("a.txt");
    t.write("dir/b.txt", body.replace("number 3", "three"));
    let c2 = t.commit_all("move a");
    t.write(
        "dir/b.txt",
        body.replace("number 3", "3!").replace("number 5", "5!"),
    );
    let c3 = t.commit_all("edit b");
    t.remove("dir/b.txt");
    t.commit_all("delete b");

    let got = records(&shim_log(&t, "dir/b.txt", 50));
    let statuses: Vec<&str> = got.iter().map(|(_, s)| s.as_str()).collect();
    assert_eq!(statuses[0], "D\tdir/b.txt");
    assert_eq!(statuses[1], "M\tdir/b.txt");
    assert!(statuses[2].starts_with("R") && statuses[2].ends_with("a.txt\tdir/b.txt"));
    assert_eq!(statuses[3], "A\ta.txt");
    assert!(got[1].0.starts_with(&c3.to_string()));
    assert!(got[2].0.starts_with(&c2.to_string()));
    assert!(got[3].0.starts_with(&c1.to_string()));
    assert!(got[3].0.contains(&format!("{US}Test User{US}")));
    assert!(got[3].0.ends_with(&format!("{US}add a")));
    assert_eq!(records(&shim_log(&t, "dir/b.txt", 2)).len(), 2);
    assert_eq!(records(&shim_log(&t, "nothing.txt", 5)).len(), 0);
    if real_git_available() {
        assert_eq!(got, records(&real_log(&t, "dir/b.txt", 50)));
    }
}

#[test]
fn log_follow_skips_merges_that_are_treesame_and_ignores_untouched_branches() {
    let mut t = TestRepo::new();
    t.write("f.txt", "one\n");
    let base = t.commit_all("add f");
    t.checkout_branch("side", base);
    t.commit_on("side", "other.txt", "x\n", "side work");
    t.commit_on("main", "f.txt", "two\n", "edit f");
    let out = sh_ok(&t, &["merge", "--no-edit", "side"]);
    assert_eq!(out.code, 0);
    let got = records(&shim_log(&t, "f.txt", 10));
    let subjects: Vec<String> = got
        .iter()
        .map(|(h, _)| h.rsplit(US).next().unwrap().to_string())
        .collect();
    assert_eq!(subjects, ["edit f", "add f"]);
    if real_git_available() {
        assert_eq!(got, records(&real_log(&t, "f.txt", 10)));
    }
}

#[test]
fn log_other_forms_are_unsupported() {
    let t = TestRepo::new();
    for args in [
        &["log", "--oneline"][..],
        &["log", "--", "a.txt"],
        &["log", "--follow", "--", "a", "b"],
        &["log", "--follow"],
    ] {
        assert_eq!(
            sh(&t, args).into_result().unwrap_err().kind,
            ErrorKind::Unsupported,
            "{args:?}"
        );
    }
}
