use std::fs;

use git2::{BranchType, Oid};

use super::*;
use crate::git::fixtures::{self, TestRepo};
use crate::git::libgit::LibGit;
use crate::git::refs_write::RefWriteService;
use crate::ipc::types::*;

fn applied(outcome: AppResult<OpOutcome>) -> String {
    match outcome.unwrap() {
        OpOutcome::Applied { oplog_id, .. } => oplog_id,
        other => panic!("expected Applied, got {other:?}"),
    }
}

fn branch_tip(t: &TestRepo, name: &str) -> Option<Oid> {
    t.repo
        .find_branch(name, BranchType::Local)
        .ok()
        .and_then(|b| b.get().target())
}

fn branch_req(name: &str, start: Option<&str>) -> BranchCreateRequest {
    BranchCreateRequest {
        name: name.into(),
        start_point: start.map(String::from),
        checkout: false,
    }
}

/// main: base -> B (m.txt); feature: base -> C (f.txt); HEAD on main.
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
fn undo_redo_branch_create() {
    let (t, ..) = fixtures::linear(2);
    applied(LibGit.branch_create(&t.repo, &branch_req("topic", None), false));
    assert!(branch_tip(&t, "topic").is_some());

    let out = Oplog::undo(&t.repo, false).unwrap();
    assert!(matches!(out, OpOutcome::Applied { .. }));
    assert!(branch_tip(&t, "topic").is_none());
    let list = Oplog::list(&t.repo, 10).unwrap();
    assert!(list[0].undone);

    Oplog::redo(&t.repo, false).unwrap();
    assert_eq!(branch_tip(&t, "topic"), Some(t.head()));
    assert!(!Oplog::list(&t.repo, 10).unwrap()[0].undone);
}

#[test]
fn undo_branch_delete_restores_branch_and_upstream_config() {
    let t = fixtures::ahead_behind();
    let tip = t.head();
    applied(LibGit.branch_create(&t.repo, &branch_req("side", None), false));
    t.repo
        .find_branch("side", BranchType::Local)
        .unwrap()
        .set_upstream(Some("origin/main"))
        .unwrap();
    applied(LibGit.branch_delete(
        &t.repo,
        &BranchDeleteRequest {
            name: "side".into(),
            remote: false,
            force: true,
        },
        false,
    ));
    assert!(branch_tip(&t, "side").is_none());
    Oplog::undo(&t.repo, false).unwrap();
    assert_eq!(branch_tip(&t, "side"), Some(tip));
    let cfg = t.repo.config().unwrap();
    assert_eq!(cfg.get_string("branch.side.remote").unwrap(), "origin");
}

#[test]
fn undo_branch_move_and_tag_create() {
    let (t, oids) = {
        let (t, oids) = fixtures::linear(3);
        (t, oids)
    };
    applied(LibGit.branch_create(
        &t.repo,
        &branch_req("topic", Some(&oids[0].to_string())),
        false,
    ));
    applied(LibGit.ref_move(
        &t.repo,
        &RefMoveRequest {
            name: "topic".into(),
            target: oids[2].to_string(),
            force: false,
        },
        false,
    ));
    assert_eq!(branch_tip(&t, "topic"), Some(oids[2]));
    Oplog::undo(&t.repo, false).unwrap();
    assert_eq!(branch_tip(&t, "topic"), Some(oids[0]));

    applied(LibGit.tag_create(
        &t.repo,
        &TagCreateRequest {
            name: "v9".into(),
            target: "HEAD".into(),
            message: None,
        },
        false,
    ));
    assert!(t.repo.find_reference("refs/tags/v9").is_ok());
    // The tag entry is the most recent not-undone one.
    Oplog::undo(&t.repo, false).unwrap();
    assert!(t.repo.find_reference("refs/tags/v9").is_err());
    Oplog::redo(&t.repo, false).unwrap();
    assert!(t.repo.find_reference("refs/tags/v9").is_ok());
}

#[test]
fn hard_reset_undo_restores_worktree_changes() {
    let (t, oids) = fixtures::linear(3);
    t.write("file.txt", "uncommitted edit\n");
    t.write("untracked.txt", "keep me\n");
    fs::create_dir_all(t.root().join("dir")).unwrap();
    t.write("dir/nested.txt", "nested\n");

    let id = applied(LibGit.reset(
        &t.repo,
        &ResetRequest {
            target: oids[0].to_string(),
            mode: ResetMode::Hard,
        },
        false,
    ));
    assert_eq!(t.head(), oids[0]);
    assert_eq!(
        fs::read_to_string(t.root().join("file.txt")).unwrap(),
        "line 0\n"
    );

    // Undo brings back HEAD and the uncommitted work.
    let out = Oplog::undo(&t.repo, false).unwrap();
    match out {
        OpOutcome::Applied { oplog_id, .. } => assert_eq!(oplog_id, id),
        other => panic!("{other:?}"),
    }
    assert_eq!(t.head(), oids[2]);
    assert_eq!(
        fs::read_to_string(t.root().join("file.txt")).unwrap(),
        "uncommitted edit\n"
    );
    assert_eq!(
        fs::read_to_string(t.root().join("untracked.txt")).unwrap(),
        "keep me\n"
    );
    assert_eq!(
        fs::read_to_string(t.root().join("dir/nested.txt")).unwrap(),
        "nested\n"
    );

    // Redo resets again.
    Oplog::redo(&t.repo, false).unwrap();
    assert_eq!(t.head(), oids[0]);
    assert_eq!(
        fs::read_to_string(t.root().join("file.txt")).unwrap(),
        "line 0\n"
    );
}

#[test]
fn hard_reset_undo_restores_deleted_and_staged_files() {
    let (t, oids) = fixtures::linear(2);
    t.write("staged.txt", "staged\n");
    t.stage_all();
    t.remove("file.txt");
    applied(LibGit.reset(
        &t.repo,
        &ResetRequest {
            target: oids[0].to_string(),
            mode: ResetMode::Hard,
        },
        false,
    ));
    assert!(!t.root().join("staged.txt").exists());
    Oplog::undo(&t.repo, false).unwrap();
    assert_eq!(
        fs::read_to_string(t.root().join("staged.txt")).unwrap(),
        "staged\n"
    );
    assert!(!t.root().join("file.txt").exists());
    // The index came back too.
    let index = t.repo.index().unwrap();
    assert!(index
        .get_path(std::path::Path::new("staged.txt"), 0)
        .is_some());
}

#[test]
fn undo_refuses_when_files_changed_after_operation() {
    let (t, ..) = two_branches();
    applied(LibGit.checkout(
        &t.repo,
        &CheckoutTarget::Branch {
            name: "feature".into(),
        },
        false,
    ));
    assert!(t.root().join("f.txt").exists());
    assert!(!t.root().join("m.txt").exists());

    t.write("f.txt", "edited after checkout\n");
    let err = Oplog::undo(&t.repo, false).unwrap_err();
    assert_eq!(err.kind, ErrorKind::DirtyWorktree);
    assert!(err.message.contains("f.txt"));
    // Nothing moved.
    assert_eq!(
        fs::read_to_string(t.root().join("f.txt")).unwrap(),
        "edited after checkout\n"
    );
    assert!(t.repo.head().unwrap().name().unwrap().ends_with("feature"));

    // The dry run reports the block instead of failing.
    let OpOutcome::Preview { preview } = Oplog::undo(&t.repo, true).unwrap() else {
        panic!("expected preview");
    };
    assert!(preview.warnings.iter().any(|w| w.contains("f.txt")));
}

#[test]
fn undo_checkout_when_clean_restores_files() {
    let (t, b, _) = two_branches();
    applied(LibGit.checkout(
        &t.repo,
        &CheckoutTarget::Branch {
            name: "feature".into(),
        },
        false,
    ));
    Oplog::undo(&t.repo, false).unwrap();
    assert_eq!(t.head(), b);
    assert!(t.root().join("m.txt").exists());
    assert!(!t.root().join("f.txt").exists());
    assert!(t.repo.head().unwrap().name().unwrap().ends_with("main"));
    let st = t.repo.statuses(None).unwrap();
    assert!(st.is_empty(), "worktree should be clean after undo");
}

#[test]
fn unrelated_local_changes_do_not_block_undo() {
    let (t, ..) = two_branches();
    applied(LibGit.checkout(
        &t.repo,
        &CheckoutTarget::Branch {
            name: "feature".into(),
        },
        false,
    ));
    t.write("base.txt", "local edit\n");
    Oplog::undo(&t.repo, false).unwrap();
    assert_eq!(
        fs::read_to_string(t.root().join("base.txt")).unwrap(),
        "local edit\n"
    );
}

#[test]
fn nothing_to_undo_or_redo() {
    let t = TestRepo::new();
    assert_eq!(
        Oplog::undo(&t.repo, false).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    assert_eq!(
        Oplog::redo(&t.repo, false).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
}

#[test]
fn new_operation_after_undo_clears_redo() {
    let (t, ..) = fixtures::linear(2);
    applied(LibGit.branch_create(&t.repo, &branch_req("one", None), false));
    Oplog::undo(&t.repo, false).unwrap();
    applied(LibGit.branch_create(&t.repo, &branch_req("two", None), false));
    assert_eq!(
        Oplog::redo(&t.repo, false).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    assert!(branch_tip(&t, "one").is_none());
    assert!(branch_tip(&t, "two").is_some());
    assert_eq!(Oplog::list(&t.repo, 10).unwrap().len(), 2);
}

#[test]
fn journal_lists_newest_first_and_pins_objects() {
    let (t, ..) = fixtures::linear(2);
    let a = applied(LibGit.branch_create(&t.repo, &branch_req("a", None), false));
    let b = applied(LibGit.branch_create(&t.repo, &branch_req("b", None), false));
    let list = Oplog::list(&t.repo, 1).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, b);
    assert_eq!(list[0].operation, "branch_create");
    assert!(t
        .repo
        .find_reference(&format!("refs/gittrunk/oplog/{a}/before"))
        .is_ok());
    assert!(t
        .repo
        .find_reference(&format!("refs/gittrunk/oplog/{a}/after"))
        .is_ok());
    assert!(t.root().join(".git/gittrunk/oplog.jsonl").exists());
    assert!(!t.root().join(".git/gittrunk/oplog.jsonl.tmp").exists());
}

#[test]
fn failed_operation_is_not_journaled() {
    let (t, ..) = fixtures::linear(1);
    let res: AppResult<((), OplogEntry)> =
        Oplog::record(&t.repo, "x", "boom".into(), false, |_| {
            Err(AppError::new(ErrorKind::Internal, "boom"))
        });
    assert!(res.is_err());
    assert!(Oplog::list(&t.repo, 10).unwrap().is_empty());
}

#[test]
fn snapshot_captures_untracked_without_touching_worktree() {
    let (t, ..) = fixtures::linear(1);
    t.write("new.txt", "n\n");
    t.write("file.txt", "changed\n");
    let snap = snapshot::capture(&t.repo, true).unwrap();
    let commit = t
        .repo
        .find_commit(Oid::from_str(snap.worktree.as_ref().unwrap()).unwrap())
        .unwrap();
    let tree = commit.tree().unwrap();
    assert!(tree.get_name("new.txt").is_some());
    let blob = t
        .repo
        .find_blob(tree.get_name("file.txt").unwrap().id())
        .unwrap();
    assert_eq!(blob.content(), b"changed\n");
    // Index and worktree untouched.
    assert_eq!(
        fs::read_to_string(t.root().join("file.txt")).unwrap(),
        "changed\n"
    );
    assert!(t
        .repo
        .statuses(None)
        .unwrap()
        .iter()
        .any(|e| e.path() == Ok("new.txt")));
}
