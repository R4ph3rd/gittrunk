use std::fs;

use super::*;
use crate::git::fixtures::TestRepo;
use crate::git::service::GitService;

fn setup() -> TestRepo {
    let mut t = TestRepo::new();
    let mut c = t.repo.config().unwrap();
    c.set_str("user.name", "Test User").unwrap();
    c.set_str("user.email", "test@example.com").unwrap();
    c.set_bool("commit.gpgsign", false).unwrap();
    t.write("a.txt", "base\n");
    t.write("b.txt", "base\n");
    t.commit_all("base");
    t
}

fn save_req(message: Option<&str>) -> StashSaveRequest {
    StashSaveRequest {
        message: message.map(String::from),
        include_untracked: false,
        keep_index: false,
    }
}

fn list(t: &TestRepo) -> Vec<StashEntry> {
    let mut repo = Repository::open(t.root()).unwrap();
    LibGit.stash_list(&mut repo).unwrap()
}

fn read(t: &TestRepo, p: &str) -> String {
    fs::read_to_string(t.root().join(p)).unwrap()
}

#[test]
fn save_with_message_and_untracked() {
    let t = setup();
    let cli = GitCli::new();
    t.write("a.txt", "changed\n");
    t.write("new.txt", "untracked\n");
    let mut req = save_req(Some("--help me"));
    req.include_untracked = true;
    let out = LibGit.stash_save(&t.repo, &cli, &req).unwrap();
    assert!(matches!(out, OpOutcome::Applied { .. }));
    assert_eq!(read(&t, "a.txt"), "base\n");
    assert!(!t.root().join("new.txt").exists());
    let stashes = list(&t);
    assert_eq!(stashes.len(), 1);
    assert!(
        stashes[0].message.ends_with("--help me"),
        "{}",
        stashes[0].message
    );
    assert_eq!(
        crate::git::oplog::Oplog::list(&t.repo, 5).unwrap()[0].operation,
        "stash_save"
    );
}

#[test]
fn save_keep_index_keeps_staged_changes() {
    let t = setup();
    let cli = GitCli::new();
    t.write("a.txt", "staged\n");
    t.stage_all();
    t.write("b.txt", "unstaged\n");
    let mut req = save_req(None);
    req.keep_index = true;
    LibGit.stash_save(&t.repo, &cli, &req).unwrap();
    assert_eq!(read(&t, "a.txt"), "staged\n");
    assert_eq!(read(&t, "b.txt"), "base\n");
    assert_eq!(list(&t).len(), 1);
}

#[test]
fn save_refuses_when_nothing_to_stash() {
    let t = setup();
    let cli = GitCli::new();
    let err = LibGit
        .stash_save(&t.repo, &cli, &save_req(None))
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    // Untracked files only count with include_untracked.
    t.write("new.txt", "x\n");
    let err = LibGit
        .stash_save(&t.repo, &cli, &save_req(None))
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    let mut req = save_req(None);
    req.include_untracked = true;
    LibGit.stash_save(&t.repo, &cli, &req).unwrap();
}

#[test]
fn apply_keeps_and_pop_drops() {
    let t = setup();
    let cli = GitCli::new();
    t.write("a.txt", "changed\n");
    LibGit
        .stash_save(&t.repo, &cli, &save_req(Some("one")))
        .unwrap();
    assert_eq!(read(&t, "a.txt"), "base\n");

    let out = LibGit.stash_apply(&t.repo, &cli, 0, false).unwrap();
    assert!(matches!(out, OpOutcome::Applied { .. }));
    assert_eq!(read(&t, "a.txt"), "changed\n");
    assert_eq!(list(&t).len(), 1);

    // Reset the file and pop it.
    t.write("a.txt", "base\n");
    let out = LibGit.stash_apply(&t.repo, &cli, 0, true).unwrap();
    assert!(matches!(out, OpOutcome::Applied { .. }));
    assert_eq!(read(&t, "a.txt"), "changed\n");
    assert!(list(&t).is_empty());
}

#[test]
fn apply_with_conflict_reports_files_and_pop_keeps_the_stash() {
    let mut t = setup();
    let cli = GitCli::new();
    t.write("a.txt", "from stash\n");
    LibGit.stash_save(&t.repo, &cli, &save_req(None)).unwrap();
    t.write("a.txt", "committed elsewhere\n");
    t.commit_all("diverge");
    let out = LibGit.stash_apply(&t.repo, &cli, 0, true).unwrap();
    let OpOutcome::Conflicted { files, .. } = out else {
        panic!("expected conflicts, got {out:?}");
    };
    assert_eq!(files, vec!["a.txt".to_string()]);
    assert!(read(&t, "a.txt").contains("<<<<<<<"));
    assert_eq!(list(&t).len(), 1, "pop must not drop on conflicts");
}

#[test]
fn apply_over_dirty_files_is_dirty_worktree() {
    let t = setup();
    let cli = GitCli::new();
    t.write("a.txt", "from stash\n");
    LibGit.stash_save(&t.repo, &cli, &save_req(None)).unwrap();
    t.write("a.txt", "local edit\n");
    let err = LibGit.stash_apply(&t.repo, &cli, 0, false).unwrap_err();
    assert_eq!(err.kind, ErrorKind::DirtyWorktree);
    assert_eq!(read(&t, "a.txt"), "local edit\n");
}

#[test]
fn bad_index_is_ref_not_found() {
    let t = setup();
    let cli = GitCli::new();
    assert_eq!(
        LibGit
            .stash_apply(&t.repo, &cli, 3, false)
            .unwrap_err()
            .kind,
        ErrorKind::RefNotFound
    );
    assert_eq!(
        LibGit.stash_drop(&t.repo, &cli, 0, true).unwrap_err().kind,
        ErrorKind::RefNotFound
    );
}

#[test]
fn drop_previews_records_and_can_be_restored() {
    let t = setup();
    let cli = GitCli::new();
    t.write("a.txt", "one\n");
    LibGit
        .stash_save(&t.repo, &cli, &save_req(Some("first")))
        .unwrap();
    t.write("a.txt", "two\n");
    LibGit
        .stash_save(&t.repo, &cli, &save_req(Some("second")))
        .unwrap();
    assert_eq!(list(&t).len(), 2);
    let dropped_oid = list(&t)[0].oid.parse::<Oid>().unwrap();

    let OpOutcome::Preview { preview } = LibGit.stash_drop(&t.repo, &cli, 0, true).unwrap() else {
        panic!("expected preview");
    };
    assert!(preview.summary.contains("second"));
    assert_eq!(list(&t).len(), 2);

    let out = LibGit.stash_drop(&t.repo, &cli, 0, false).unwrap();
    assert!(matches!(out, OpOutcome::Applied { .. }));
    let left = list(&t);
    assert_eq!(left.len(), 1);
    assert!(left[0].message.ends_with("first"));
    assert_eq!(
        crate::git::oplog::Oplog::list(&t.repo, 5).unwrap()[0].operation,
        "stash_drop"
    );

    // The dropped commit is pinned and can be stored back.
    assert!(t.repo.find_reference(&pin_name(dropped_oid)).is_ok());
    restore_dropped(&t.repo, &cli, dropped_oid).unwrap();
    let back = list(&t);
    assert_eq!(back.len(), 2);
    assert_eq!(back[0].oid, dropped_oid.to_string());
}
