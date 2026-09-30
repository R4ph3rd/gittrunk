use std::fs;

use git2::{BranchType, Oid};

use super::*;
use crate::git::fixtures::{self, TestRepo};
use crate::git::oplog::Oplog;

fn preview(o: AppResult<OpOutcome>) -> OpPreview {
    match o.unwrap() {
        OpOutcome::Preview { preview } => preview,
        other => panic!("expected preview, got {other:?}"),
    }
}

fn applied(o: AppResult<OpOutcome>) -> (String, HeadState) {
    match o.unwrap() {
        OpOutcome::Applied { oplog_id, head, .. } => (oplog_id, head),
        other => panic!("expected applied, got {other:?}"),
    }
}

fn tip(t: &TestRepo, name: &str) -> Option<Oid> {
    t.repo
        .find_branch(name, BranchType::Local)
        .ok()
        .and_then(|b| b.get().target())
}

fn create(name: &str, start: Option<&str>, checkout: bool) -> BranchCreateRequest {
    BranchCreateRequest {
        name: name.into(),
        start_point: start.map(String::from),
        checkout,
    }
}

fn journal_len(t: &TestRepo) -> usize {
    Oplog::list(&t.repo, 100).unwrap().len()
}

/// main: A -> B (m.txt); feature: A -> C (f.txt); HEAD on main.
fn two_branches() -> (TestRepo, Oid, Oid) {
    let mut t = TestRepo::new();
    t.write("base.txt", "base\n");
    let a = t.commit_all("A");
    t.checkout_branch("feature", a);
    let c = t.commit_on("feature", "f.txt", "feature\n", "C");
    t.repo.set_head("refs/heads/main").unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    let b = t.commit_on("main", "m.txt", "main\n", "B");
    (t, b, c)
}

#[test]
fn branch_create_defaults_to_head_and_dry_run_writes_nothing() {
    let (t, oids) = fixtures::linear(2);
    let p = preview(LibGit.branch_create(&t.repo, &create("topic", None, false), true));
    assert_eq!(p.ref_updates[0].name, "refs/heads/topic");
    assert_eq!(p.ref_updates[0].to, Some(oids[1].to_string()));
    assert!(tip(&t, "topic").is_none());
    assert_eq!(journal_len(&t), 0);

    let (id, head) = applied(LibGit.branch_create(&t.repo, &create("topic", None, false), false));
    assert!(!id.is_empty());
    assert_eq!(tip(&t, "topic"), Some(oids[1]));
    assert!(matches!(head, HeadState::Branch { name, .. } if name == "main"));
    assert_eq!(journal_len(&t), 1);
}

#[test]
fn branch_create_with_start_point_checkout_and_errors() {
    let (t, oids) = fixtures::linear(3);
    let start = oids[0].to_string();
    let (_, head) =
        applied(LibGit.branch_create(&t.repo, &create("old", Some(&start), true), false));
    assert!(matches!(head, HeadState::Branch { name, oid } if name == "old" && oid == start));
    assert_eq!(
        fs::read_to_string(t.root().join("file.txt")).unwrap(),
        "line 0\n"
    );
    let err = LibGit
        .branch_create(&t.repo, &create("old", None, false), false)
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    let err = LibGit
        .branch_create(&t.repo, &create("bad name", None, false), false)
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    let err = LibGit
        .branch_create(&t.repo, &create("x", Some("nope"), false), false)
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::RefNotFound);
}

#[test]
fn branch_delete_requires_merge_unless_forced() {
    let (t, b, c) = two_branches();
    let req = |name: &str, force: bool| BranchDeleteRequest {
        name: name.into(),
        remote: false,
        force,
    };
    // `feature` has commit C that main does not contain.
    let err = LibGit
        .branch_delete(&t.repo, &req("feature", false), false)
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    assert!(err.message.contains("not fully merged"));
    assert_eq!(tip(&t, "feature"), Some(c));

    let p = preview(LibGit.branch_delete(&t.repo, &req("feature", true), true));
    assert!(p.warnings.iter().any(|w| w.contains("not fully merged")));
    assert_eq!(p.commits_dropped.len(), 1);
    assert_eq!(p.commits_dropped[0].summary, "C");

    applied(LibGit.branch_delete(&t.repo, &req("feature", true), false));
    assert!(tip(&t, "feature").is_none());

    // A merged branch deletes without force.
    applied(LibGit.branch_create(&t.repo, &create("merged", None, false), false));
    applied(LibGit.branch_delete(&t.repo, &req("merged", false), false));
    assert!(tip(&t, "merged").is_none());
    assert_eq!(tip(&t, "main"), Some(b));
}

#[test]
fn branch_delete_refuses_checked_out_and_remote() {
    let (t, ..) = fixtures::linear(1);
    let err = LibGit
        .branch_delete(
            &t.repo,
            &BranchDeleteRequest {
                name: "main".into(),
                remote: false,
                force: true,
            },
            false,
        )
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    let err = LibGit
        .branch_delete(
            &t.repo,
            &BranchDeleteRequest {
                name: "x".into(),
                remote: true,
                force: false,
            },
            false,
        )
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::NotImplemented);
}

#[test]
fn branch_delete_merged_into_upstream() {
    let t = fixtures::ahead_behind();
    // `topic` is at the remote tip, which HEAD (main) does not contain.
    let remote = t
        .repo
        .find_reference("refs/remotes/origin/main")
        .unwrap()
        .target()
        .unwrap();
    let commit = t.repo.find_commit(remote).unwrap();
    let mut b = t.repo.branch("topic", &commit, false).unwrap();
    b.set_upstream(Some("origin/main")).unwrap();
    drop(b);
    applied(LibGit.branch_delete(
        &t.repo,
        &BranchDeleteRequest {
            name: "topic".into(),
            remote: false,
            force: false,
        },
        false,
    ));
    assert!(tip(&t, "topic").is_none());
}

#[test]
fn branch_rename_moves_upstream_config() {
    let t = fixtures::ahead_behind();
    let old_tip = tip(&t, "main").unwrap();
    applied(LibGit.branch_create(&t.repo, &create("side", None, false), false));
    t.repo
        .find_branch("side", BranchType::Local)
        .unwrap()
        .set_upstream(Some("origin/main"))
        .unwrap();
    let p = preview(LibGit.branch_rename(&t.repo, "side", "renamed", true));
    assert_eq!(p.ref_updates.len(), 2);
    applied(LibGit.branch_rename(&t.repo, "side", "renamed", false));
    assert!(tip(&t, "side").is_none());
    assert_eq!(tip(&t, "renamed"), Some(old_tip));
    let cfg = t.repo.config().unwrap();
    assert_eq!(cfg.get_string("branch.renamed.remote").unwrap(), "origin");
    assert!(cfg.get_string("branch.side.remote").is_err());
    let err = LibGit
        .branch_rename(&t.repo, "renamed", "main", false)
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
}

#[test]
fn checkout_branch_commit_and_detached_warning() {
    let (t, b, c) = two_branches();
    let p = preview(LibGit.checkout(
        &t.repo,
        &CheckoutTarget::Branch {
            name: "feature".into(),
        },
        true,
    ));
    assert_eq!(p.ref_updates[0].name, "HEAD");
    assert_eq!(journal_len(&t), 0);

    let (_, head) = applied(LibGit.checkout(
        &t.repo,
        &CheckoutTarget::Branch {
            name: "feature".into(),
        },
        false,
    ));
    assert!(
        matches!(head, HeadState::Branch { name, oid } if name == "feature" && oid == c.to_string())
    );
    assert!(t.root().join("f.txt").exists());
    assert!(!t.root().join("m.txt").exists());

    let p = preview(LibGit.checkout(
        &t.repo,
        &CheckoutTarget::Commit {
            oid: b.to_string()[..10].to_string(),
        },
        true,
    ));
    assert!(p.warnings.contains(&"detached HEAD".to_string()));
    let (_, head) = applied(LibGit.checkout(
        &t.repo,
        &CheckoutTarget::Commit { oid: b.to_string() },
        false,
    ));
    assert!(matches!(head, HeadState::Detached { oid } if oid == b.to_string()));
    assert!(t.root().join("m.txt").exists());
}

#[test]
fn checkout_remote_branch_creates_tracking_branch() {
    let t = fixtures::ahead_behind();
    let remote_tip = t
        .repo
        .find_reference("refs/remotes/origin/main")
        .unwrap()
        .target()
        .unwrap();
    // The fixture leaves `r.txt` staged; start from a clean tree.
    let head = t
        .repo
        .head()
        .unwrap()
        .peel(git2::ObjectType::Commit)
        .unwrap();
    t.repo.reset(&head, git2::ResetType::Hard, None).unwrap();
    // Pretend the remote has a feature branch too.
    t.repo
        .reference("refs/remotes/origin/feature", remote_tip, true, "")
        .unwrap();
    let (_, head) = applied(LibGit.checkout(
        &t.repo,
        &CheckoutTarget::RemoteBranch {
            name: "origin/feature".into(),
            local_name: "feature".into(),
        },
        false,
    ));
    assert!(matches!(head, HeadState::Branch { name, .. } if name == "feature"));
    let b = t.repo.find_branch("feature", BranchType::Local).unwrap();
    assert_eq!(
        b.upstream().unwrap().name().unwrap(),
        Some("origin/feature")
    );
    assert_eq!(tip(&t, "feature"), Some(remote_tip));
    // Undo removes the new branch again and returns to main.
    Oplog::undo(&t.repo, false).unwrap();
    assert!(tip(&t, "feature").is_none());
    assert!(t.repo.head().unwrap().name().unwrap().ends_with("main"));
    let err = LibGit
        .checkout(
            &t.repo,
            &CheckoutTarget::RemoteBranch {
                name: "origin/nope".into(),
                local_name: "nope".into(),
            },
            false,
        )
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::RefNotFound);
}

#[test]
fn checkout_refuses_when_local_changes_would_be_overwritten() {
    let mut t = TestRepo::new();
    t.write("shared.txt", "one\n");
    let a = t.commit_all("A");
    t.checkout_branch("other", a);
    t.commit_on("other", "shared.txt", "two\n", "change shared");
    t.repo.set_head("refs/heads/main").unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    t.write("shared.txt", "local edit\n");
    t.write("unrelated.txt", "x\n");

    let err = LibGit
        .checkout(
            &t.repo,
            &CheckoutTarget::Branch {
                name: "other".into(),
            },
            false,
        )
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::DirtyWorktree);
    assert!(err.message.contains("shared.txt"), "{}", err.message);
    assert_eq!(err.detail.as_deref(), Some("shared.txt"));
    assert_eq!(
        fs::read_to_string(t.root().join("shared.txt")).unwrap(),
        "local edit\n"
    );
    assert!(t.repo.head().unwrap().name().unwrap().ends_with("main"));
    // Dry run fails the same way.
    let err = LibGit
        .checkout(
            &t.repo,
            &CheckoutTarget::Branch {
                name: "other".into(),
            },
            true,
        )
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::DirtyWorktree);
    assert_eq!(journal_len(&t), 0);
}

#[test]
fn checkout_keeps_unrelated_local_changes() {
    let (t, ..) = two_branches();
    t.write("base.txt", "local edit\n");
    applied(LibGit.checkout(
        &t.repo,
        &CheckoutTarget::Branch {
            name: "feature".into(),
        },
        false,
    ));
    assert_eq!(
        fs::read_to_string(t.root().join("base.txt")).unwrap(),
        "local edit\n"
    );
}

#[test]
fn tag_create_lightweight_and_annotated() {
    let (t, oids) = fixtures::linear(2);
    let light = TagCreateRequest {
        name: "light".into(),
        target: oids[0].to_string(),
        message: None,
    };
    let p = preview(LibGit.tag_create(&t.repo, &light, true));
    assert_eq!(p.ref_updates[0].name, "refs/tags/light");
    assert!(t.repo.find_reference("refs/tags/light").is_err());
    applied(LibGit.tag_create(&t.repo, &light, false));
    assert_eq!(
        t.repo.find_reference("refs/tags/light").unwrap().target(),
        Some(oids[0])
    );

    // No user.name / user.email configured in the fixture: annotated fails
    // clearly (unless the machine has a global identity).
    let annotated = TagCreateRequest {
        name: "v1".into(),
        target: "HEAD".into(),
        message: Some("release\n".into()),
    };
    if t.repo.signature().is_err() {
        let err = LibGit.tag_create(&t.repo, &annotated, false).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput);
        assert!(err.message.contains("user.name"));
    }
    let mut cfg = t.repo.config().unwrap();
    cfg.set_str("user.name", "Tagger").unwrap();
    cfg.set_str("user.email", "tagger@example.com").unwrap();
    applied(LibGit.tag_create(&t.repo, &annotated, false));
    let tag = t
        .repo
        .find_reference("refs/tags/v1")
        .unwrap()
        .peel_to_tag()
        .unwrap();
    assert_eq!(tag.message().unwrap(), Some("release\n"));
    assert_eq!(tag.target_id(), oids[1]);

    let err = LibGit.tag_create(&t.repo, &light, false).unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
}

#[test]
fn tag_delete_and_undo() {
    let (t, first, _) = fixtures::tags();
    let p = preview(LibGit.tag_delete(&t.repo, "v0.1", true));
    assert_eq!(p.ref_updates[0].to, None);
    assert!(t.repo.find_reference("refs/tags/v0.1").is_ok());
    applied(LibGit.tag_delete(&t.repo, "v0.1", false));
    assert!(t.repo.find_reference("refs/tags/v0.1").is_err());
    Oplog::undo(&t.repo, false).unwrap();
    assert_eq!(
        t.repo.find_reference("refs/tags/v0.1").unwrap().target(),
        Some(first)
    );
    // Annotated tags come back with their tag object.
    applied(LibGit.tag_delete(&t.repo, "v1.0", false));
    Oplog::undo(&t.repo, false).unwrap();
    assert!(t
        .repo
        .find_reference("refs/tags/v1.0")
        .unwrap()
        .peel_to_tag()
        .is_ok());
    let err = LibGit.tag_delete(&t.repo, "nope", false).unwrap_err();
    assert_eq!(err.kind, ErrorKind::RefNotFound);
}

#[test]
fn ref_move_rules() {
    let (t, oids) = fixtures::linear(4);
    applied(LibGit.branch_create(&t.repo, &create("topic", None, false), false));
    let mv = |name: &str, target: Oid, force: bool| RefMoveRequest {
        name: name.into(),
        target: target.to_string(),
        force,
    };
    // Moving back is fine while `main` still holds the commits.
    applied(LibGit.ref_move(&t.repo, &mv("topic", oids[0], false), false));
    assert_eq!(tip(&t, "topic"), Some(oids[0]));
    // Forward moves are fine.
    applied(LibGit.ref_move(&t.repo, &mv("topic", oids[2], false), false));
    assert_eq!(tip(&t, "topic"), Some(oids[2]));
}

#[test]
fn ref_move_needs_force_when_commits_would_be_dropped() {
    let (t, b, c) = two_branches();
    let mv = |force: bool| RefMoveRequest {
        name: "feature".into(),
        target: b.to_string(),
        force,
    };
    let err = LibGit.ref_move(&t.repo, &mv(false), false).unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    assert!(err.message.contains("unreachable"));
    let p = preview(LibGit.ref_move(&t.repo, &mv(true), true));
    assert_eq!(p.commits_dropped.len(), 1);
    assert_eq!(tip(&t, "feature"), Some(c));
    applied(LibGit.ref_move(&t.repo, &mv(true), false));
    assert_eq!(tip(&t, "feature"), Some(b));
    Oplog::undo(&t.repo, false).unwrap();
    assert_eq!(tip(&t, "feature"), Some(c));
}

#[test]
fn ref_move_checked_out_branch_is_soft_reset() {
    let (t, oids) = fixtures::linear(3);
    t.write("file.txt", "dirty\n");
    let req = |force| RefMoveRequest {
        name: "main".into(),
        target: oids[0].to_string(),
        force,
    };
    let err = LibGit.ref_move(&t.repo, &req(false), false).unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    assert!(err.message.contains("checked out"));
    applied(LibGit.ref_move(&t.repo, &req(true), false));
    assert_eq!(t.head(), oids[0]);
    // Working tree untouched.
    assert_eq!(
        fs::read_to_string(t.root().join("file.txt")).unwrap(),
        "dirty\n"
    );
    let err = LibGit
        .ref_move(
            &t.repo,
            &RefMoveRequest {
                name: "nope".into(),
                target: oids[0].to_string(),
                force: true,
            },
            false,
        )
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::RefNotFound);
}

#[test]
fn ref_move_tag() {
    let (t, first, second) = fixtures::tags();
    applied(LibGit.ref_move(
        &t.repo,
        &RefMoveRequest {
            name: "v0.1".into(),
            target: second.to_string(),
            force: false,
        },
        false,
    ));
    assert_eq!(
        t.repo.find_reference("refs/tags/v0.1").unwrap().target(),
        Some(second)
    );
    let _ = first;
}

#[test]
fn reset_modes() {
    let (t, oids) = fixtures::linear(3);
    let req = |mode| ResetRequest {
        target: oids[1].to_string(),
        mode,
    };
    let p = preview(LibGit.reset(&t.repo, &req(ResetMode::Hard), true));
    assert_eq!(p.commits_dropped.len(), 1);
    assert_eq!(t.head(), oids[2]);
    assert_eq!(journal_len(&t), 0);

    // Soft: HEAD moves, index keeps the newer content.
    applied(LibGit.reset(&t.repo, &req(ResetMode::Soft), false));
    assert_eq!(t.head(), oids[1]);
    assert!(t
        .repo
        .statuses(None)
        .unwrap()
        .iter()
        .any(|e| e.status().contains(git2::Status::INDEX_MODIFIED)));
    Oplog::undo(&t.repo, false).unwrap();
    assert_eq!(t.head(), oids[2]);
    assert!(t.repo.statuses(None).unwrap().is_empty());

    // Mixed: index reset, worktree keeps newer content.
    applied(LibGit.reset(&t.repo, &req(ResetMode::Mixed), false));
    assert_eq!(t.head(), oids[1]);
    assert_eq!(
        fs::read_to_string(t.root().join("file.txt")).unwrap(),
        "line 2\n"
    );
    assert!(t
        .repo
        .statuses(None)
        .unwrap()
        .iter()
        .any(|e| e.status().contains(git2::Status::WT_MODIFIED)));
    Oplog::undo(&t.repo, false).unwrap();
    assert_eq!(t.head(), oids[2]);
    assert!(t.repo.statuses(None).unwrap().is_empty());

    // Hard warns about uncommitted changes.
    t.write("file.txt", "wip\n");
    let p = preview(LibGit.reset(&t.repo, &req(ResetMode::Hard), true));
    assert!(p.warnings.iter().any(|w| w.contains("uncommitted")));
    let err = LibGit
        .reset(
            &t.repo,
            &ResetRequest {
                target: "nope".into(),
                mode: ResetMode::Hard,
            },
            false,
        )
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::RefNotFound);
}
