//! Working-tree checks and restores must go through git's filters
//! (`core.autocrlf`, `.gitattributes`): a checked-out CRLF file is not a local
//! modification, and restores write what `git checkout` would write.

use std::fs;

use git2::Oid;

use crate::git::cli::GitCli;
use crate::git::fixtures::TestRepo;
use crate::git::libgit::LibGit;
use crate::git::oplog::Oplog;
use crate::git::refs_write::RefWriteService;
use crate::git::staging::StagingService;
use crate::git::stash_write::StashWriteService;
use crate::ipc::error::ErrorKind;
use crate::ipc::types::*;

#[derive(Clone, Copy, Debug)]
enum Mode {
    Autocrlf,
    Attributes,
}

const MODES: [Mode; 2] = [Mode::Autocrlf, Mode::Attributes];

fn crlf(s: &str) -> String {
    s.replace('\n', "\r\n")
}

fn read(t: &TestRepo, p: &str) -> String {
    fs::read_to_string(t.root().join(p)).unwrap()
}

/// main: base.txt, x.txt="one"; feature: x.txt="two", f.txt. HEAD on main.
/// The working tree is checked out with CRLF line endings.
fn setup(mode: Mode) -> (TestRepo, Oid, Oid) {
    let mut t = TestRepo::new();
    let mut c = t.repo.config().unwrap();
    c.set_str("user.name", "Test User").unwrap();
    c.set_str("user.email", "test@example.com").unwrap();
    c.set_bool("commit.gpgsign", false).unwrap();
    match mode {
        Mode::Autocrlf => t.enable_autocrlf(),
        Mode::Attributes => t.write_crlf_attributes(),
    }
    t.write("base.txt", "base\n");
    t.write("x.txt", "one\n");
    let a = t.commit_all("A");
    t.checkout_branch("feature", a);
    let c = t.commit_on("feature", "x.txt", "two\nmore\n", "C");
    t.write("f.txt", "feature\n");
    t.commit_all("C2");
    t.repo.set_head("refs/heads/main").unwrap();
    // Rewrite every file through the smudge filters, as a real checkout does.
    for f in ["base.txt", "x.txt", "f.txt"] {
        let _ = fs::remove_file(t.root().join(f));
    }
    {
        let head = t.repo.find_object(t.head(), None).unwrap();
        t.repo
            .reset(
                &head,
                git2::ResetType::Hard,
                Some(git2::build::CheckoutBuilder::new().force()),
            )
            .unwrap();
    }
    // Blobs stay LF, the working tree is CRLF.
    assert_eq!(read(&t, "base.txt"), crlf("base\n"), "{mode:?}");
    let dirty: Vec<_> = {
        let st = t.repo.statuses(None).unwrap();
        let v = st
            .iter()
            .map(|e| (e.path().map(String::from), e.status()))
            .collect();
        v
    };
    assert!(dirty.is_empty(), "{mode:?} {dirty:?}");
    (t, a, c)
}

fn checkout_feature(t: &TestRepo) -> AppResultOutcome {
    LibGit.checkout(
        &t.repo,
        &CheckoutTarget::Branch {
            name: "feature".into(),
        },
        false,
    )
}

type AppResultOutcome = crate::ipc::error::AppResult<OpOutcome>;

#[test]
fn clean_checkout_between_branches_is_not_dirty() {
    for mode in MODES {
        let (t, ..) = setup(mode);
        let preview = LibGit
            .checkout(
                &t.repo,
                &CheckoutTarget::Branch {
                    name: "feature".into(),
                },
                true,
            )
            .unwrap();
        assert!(matches!(preview, OpOutcome::Preview { .. }), "{mode:?}");
        checkout_feature(&t).unwrap();
        assert_eq!(read(&t, "x.txt"), crlf("two\nmore\n"), "{mode:?}");
        assert_eq!(read(&t, "f.txt"), crlf("feature\n"), "{mode:?}");
        assert!(t.repo.statuses(None).unwrap().is_empty(), "{mode:?}");
    }
}

#[test]
fn genuine_modification_is_still_dirty() {
    for mode in MODES {
        let (t, ..) = setup(mode);
        t.write("x.txt", "local edit\r\n");
        let err = checkout_feature(&t).unwrap_err();
        assert_eq!(err.kind, ErrorKind::DirtyWorktree, "{mode:?}");
        assert_eq!(read(&t, "x.txt"), "local edit\r\n");
    }
}

#[test]
fn undo_checkout_restores_crlf_files_and_stays_clean() {
    for mode in MODES {
        let (t, b, _) = setup(mode);
        checkout_feature(&t).unwrap();
        Oplog::undo(&t.repo, false).unwrap();
        assert_eq!(t.head(), b, "{mode:?}");
        assert_eq!(read(&t, "x.txt"), crlf("one\n"), "{mode:?}");
        assert!(!t.root().join("f.txt").exists());
        assert!(t.repo.statuses(None).unwrap().is_empty(), "{mode:?}");
        // Redo goes back without complaining either.
        Oplog::redo(&t.repo, false).unwrap();
        assert_eq!(read(&t, "x.txt"), crlf("two\nmore\n"), "{mode:?}");
        assert!(t.repo.statuses(None).unwrap().is_empty(), "{mode:?}");
    }
}

#[test]
fn undo_is_still_blocked_by_a_genuine_change() {
    for mode in MODES {
        let (t, ..) = setup(mode);
        checkout_feature(&t).unwrap();
        t.write("x.txt", "changed later\r\n");
        let err = Oplog::undo(&t.repo, false).unwrap_err();
        assert_eq!(err.kind, ErrorKind::DirtyWorktree, "{mode:?}");
    }
}

#[test]
fn hard_reset_undo_restores_worktree_changes() {
    for mode in MODES {
        let (t, a, _) = setup(mode);
        // Move main forward with a commit that changes x.txt.
        let mut t = t;
        t.write("x.txt", "three\n");
        t.commit_all("D");
        t.write("base.txt", "edited\r\n");
        LibGit
            .reset(
                &t.repo,
                &ResetRequest {
                    target: a.to_string(),
                    mode: ResetMode::Hard,
                },
                false,
            )
            .unwrap();
        assert_eq!(read(&t, "x.txt"), crlf("one\n"), "{mode:?}");
        Oplog::undo(&t.repo, false).unwrap();
        assert_eq!(read(&t, "x.txt"), crlf("three\n"), "{mode:?}");
        assert_eq!(read(&t, "base.txt"), "edited\r\n", "{mode:?}");
        let st = t.repo.statuses(None).unwrap();
        assert_eq!(st.len(), 1, "{mode:?}: only base.txt is modified");
    }
}

#[test]
fn discard_restores_what_git_checkout_writes() {
    for mode in MODES {
        let (t, ..) = setup(mode);
        let expected = fs::read(t.root().join("base.txt")).unwrap();
        t.write("base.txt", "edited\r\n");
        t.remove("x.txt");
        LibGit
            .discard_paths(&t.repo, &["base.txt".into(), "x.txt".into()], false)
            .unwrap();
        assert_eq!(
            fs::read(t.root().join("base.txt")).unwrap(),
            expected,
            "{mode:?}"
        );
        assert_eq!(read(&t, "x.txt"), crlf("one\n"), "{mode:?}");
        assert!(t.repo.statuses(None).unwrap().is_empty(), "{mode:?}");
        // Undo brings the discarded edit back.
        Oplog::undo(&t.repo, false).unwrap();
        assert_eq!(read(&t, "base.txt"), "edited\r\n", "{mode:?}");
        assert!(!t.root().join("x.txt").exists(), "{mode:?}");
    }
}

#[test]
fn snapshots_do_not_record_spurious_changes() {
    for mode in MODES {
        let (t, ..) = setup(mode);
        t.write("base.txt", "edited\r\n");
        let tree = crate::git::oplog::snapshot::worktree_tree(&t.repo).unwrap();
        let head_tree = t.repo.head().unwrap().peel_to_tree().unwrap();
        let diff = t
            .repo
            .diff_tree_to_tree(
                Some(&head_tree),
                Some(&t.repo.find_tree(tree).unwrap()),
                None,
            )
            .unwrap();
        let paths: Vec<_> = diff
            .deltas()
            .map(|d| d.new_file().path().unwrap().to_owned())
            .collect();
        assert_eq!(
            paths,
            vec![std::path::PathBuf::from("base.txt")],
            "{mode:?}"
        );
    }
}

#[test]
fn stash_save_and_apply_round_trip() {
    for mode in MODES {
        let (t, ..) = setup(mode);
        let cli = GitCli::new();
        t.write("base.txt", "changed\r\n");
        LibGit
            .stash_save(
                &t.repo,
                &cli,
                &StashSaveRequest {
                    message: None,
                    include_untracked: false,
                    keep_index: false,
                },
            )
            .unwrap();
        assert_eq!(read(&t, "base.txt"), crlf("base\n"), "{mode:?}");
        assert!(t.repo.statuses(None).unwrap().is_empty(), "{mode:?}");
        LibGit.stash_apply(&t.repo, &cli, 0, false).unwrap();
        assert_eq!(read(&t, "base.txt"), "changed\r\n", "{mode:?}");
    }
}
