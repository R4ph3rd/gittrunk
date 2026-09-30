use std::process::Command;

use super::*;
use crate::git::fixtures::{self, TestRepo};

fn git(t: &TestRepo, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .args(["-c", "user.name=Test", "-c", "user.email=t@example.com"])
        .args(args)
        .current_dir(t.root())
        .env("GIT_EDITOR", "true")
        .output()
        .unwrap()
}

fn commit_bytes(t: &mut TestRepo, branch: &str, bytes: [u8; 3], msg: &str) {
    t.repo.set_head(&format!("refs/heads/{branch}")).unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    t.write("bin.dat", bytes);
    t.commit_all(msg);
}

/// main and other both edit conflict.txt (plus a binary conflict); merge stops.
fn merged_with_cli() -> TestRepo {
    let mut t = TestRepo::new();
    t.write("conflict.txt", "base\n");
    t.write("bin.dat", [0u8, 1, 2]);
    let a = t.commit_all("base");
    t.checkout_branch("other", a);
    commit_bytes(&mut t, "other", [0u8, 9, 9], "other bin");
    t.commit_on("other", "conflict.txt", "other side\n", "other change");
    commit_bytes(&mut t, "main", [0u8, 7, 7], "main bin");
    t.commit_on("main", "conflict.txt", "main side\n", "main change");
    let out = git(&t, &["merge", "--no-edit", "other"]);
    assert!(!out.status.success());
    t
}

#[test]
fn list_and_file_report_stages_and_labels() {
    let t = merged_with_cli();
    let list = LibGit.conflict_list(&t.repo).unwrap();
    let paths: Vec<_> = list.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, ["bin.dat", "conflict.txt"]);
    assert!(list.iter().all(|f| f.status == ChangeStatus::Conflicted));

    let f = LibGit.conflict_file(&t.repo, "conflict.txt").unwrap();
    assert!(!f.binary);
    assert_eq!(f.base.as_deref(), Some("base\n"));
    assert_eq!(f.ours.as_deref(), Some("main side\n"));
    assert_eq!(f.theirs.as_deref(), Some("other side\n"));
    assert!(f.merged.contains("<<<<<<<") && f.merged.contains(">>>>>>>"));
    assert_eq!(f.ours_label, "main");
    assert_eq!(f.theirs_label, "other");

    let b = LibGit.conflict_file(&t.repo, "bin.dat").unwrap();
    assert!(b.binary);
    assert!(b.base.is_none() && b.ours.is_none() && b.theirs.is_none());
}

#[test]
fn resolve_ours_theirs_and_content_stage_the_file() {
    let t = merged_with_cli();
    LibGit
        .conflict_resolve(&t.repo, "conflict.txt", &ConflictResolution::Theirs)
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(t.root().join("conflict.txt")).unwrap(),
        "other side\n"
    );
    LibGit
        .conflict_resolve(
            &t.repo,
            "bin.dat",
            &ConflictResolution::Content {
                content: "text now\n".into(),
            },
        )
        .unwrap();
    assert!(conflicted_paths(&t.repo).unwrap().is_empty());
    assert!(git(&t, &["commit", "--no-edit"]).status.success());

    let t = merged_with_cli();
    LibGit
        .conflict_resolve(&t.repo, "conflict.txt", &ConflictResolution::Ours)
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(t.root().join("conflict.txt")).unwrap(),
        "main side\n"
    );
    assert_eq!(conflicted_paths(&t.repo).unwrap(), ["bin.dat"]);
}

#[test]
fn unsafe_or_unconflicted_paths_are_rejected() {
    let t = fixtures::conflicted_merge();
    for bad in [
        "--exec=touch pwned",
        "../outside",
        "/etc/passwd",
        "",
        "nope.txt",
    ] {
        let err = LibGit
            .conflict_resolve(&t.repo, bad, &ConflictResolution::Ours)
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput, "{bad}");
        assert_eq!(
            LibGit.conflict_file(&t.repo, bad).unwrap_err().kind,
            ErrorKind::InvalidInput
        );
    }
    assert!(!t.root().join("pwned").exists());
}
