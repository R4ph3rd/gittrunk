use std::fs;

use git2::{ObjectType, Repository, Status};

use super::*;
use crate::git::fixtures::TestRepo;
use crate::git::service::GitService;

const OPTS: DiffOptions = DiffOptions {
    context_lines: 1,
    ignore_whitespace: false,
};

fn set_identity(repo: &Repository) {
    let mut c = repo.config().unwrap();
    c.set_str("user.name", "Test User").unwrap();
    c.set_str("user.email", "test@example.com").unwrap();
    c.set_bool("commit.gpgsign", false).unwrap();
}

fn diff(repo: &Repository, path: &str, staged: bool) -> FileDiff {
    LibGit
        .worktree_file_diff(repo, path, staged, &OPTS)
        .unwrap()
}

/// (hunk index, line index) of the first line of `kind` with `content`.
fn find(d: &FileDiff, kind: LineKind, content: &str) -> (u32, u32) {
    for (h, hunk) in d.hunks.iter().enumerate() {
        for (l, line) in hunk.lines.iter().enumerate() {
            if line.kind == kind && line.content == content {
                return (h as u32, l as u32);
            }
        }
    }
    panic!("no {kind:?} line `{content}`");
}

fn lines(path: &str, picks: &[(u32, u32)]) -> LineSelection {
    let mut hunks: Vec<HunkSelection> = Vec::new();
    for &(h, l) in picks {
        match hunks.iter_mut().find(|s| s.hunk_index == h) {
            Some(s) => s.lines.as_mut().unwrap().push(l),
            None => hunks.push(HunkSelection {
                hunk_index: h,
                lines: Some(vec![l]),
            }),
        }
    }
    LineSelection {
        path: path.into(),
        options: OPTS,
        hunks,
    }
}

fn whole(path: &str, hunk: u32) -> LineSelection {
    LineSelection {
        path: path.into(),
        options: OPTS,
        hunks: vec![HunkSelection {
            hunk_index: hunk,
            lines: None,
        }],
    }
}

fn index_bytes(repo: &Repository, path: &str) -> Option<Vec<u8>> {
    let mut index = repo.index().unwrap();
    index.read(true).unwrap();
    let e = index.get_path(Path::new(path), 0)?;
    Some(repo.find_blob(e.id).unwrap().content().to_vec())
}

fn head_bytes(repo: &Repository, path: &str) -> Option<Vec<u8>> {
    let tree = repo.head().ok()?.peel_to_tree().ok()?;
    let e = tree.get_path(Path::new(path)).ok()?;
    assert_eq!(e.kind(), Some(ObjectType::Blob));
    Some(repo.find_blob(e.id()).unwrap().content().to_vec())
}

fn numbered(n: usize) -> String {
    (1..=n).map(|i| format!("l{i}\n")).collect()
}

/// Base of 20 lines; edits in two separate hunks (with 1 line of context).
fn two_hunk_repo() -> TestRepo {
    let mut t = TestRepo::new();
    t.write("f.txt", numbered(20));
    t.commit_all("base");
    let mut v: Vec<String> = numbered(20).lines().map(str::to_string).collect();
    v[1] = "L2".into(); // l2 -> L2
    v.insert(3, "new-a".into()); // after l3
    v.remove(18); // drops l18 (index shifted by the insert)
    let mut out = v.join("\n");
    out.push('\n');
    t.write("f.txt", out);
    t
}

#[test]
fn stage_selected_lines_of_two_hunks() {
    let t = two_hunk_repo();
    let d = diff(&t.repo, "f.txt", false);
    assert_eq!(d.hunks.len(), 2);
    let sel = lines(
        "f.txt",
        &[
            find(&d, LineKind::Add, "new-a"),
            find(&d, LineKind::Delete, "l18"),
        ],
    );
    LibGit.stage_lines(&t.repo, &sel).unwrap();

    let mut expect: Vec<String> = numbered(20).lines().map(str::to_string).collect();
    expect.insert(3, "new-a".into());
    expect.retain(|l| l != "l18");
    let expect = format!("{}\n", expect.join("\n"));
    assert_eq!(index_bytes(&t.repo, "f.txt").unwrap(), expect.as_bytes());

    // What is left unstaged: the l2 -> L2 change only.
    let rest = diff(&t.repo, "f.txt", false);
    assert!(rest
        .hunks
        .iter()
        .flat_map(|h| &h.lines)
        .any(|l| l.kind == LineKind::Add && l.content == "L2"));
    assert!(!rest
        .hunks
        .iter()
        .flat_map(|h| &h.lines)
        .any(|l| l.content == "new-a" && l.kind != LineKind::Context));
}

#[test]
fn stage_whole_hunk_and_replacement_pair() {
    let t = two_hunk_repo();
    LibGit.stage_lines(&t.repo, &whole("f.txt", 0)).unwrap();
    let got = String::from_utf8(index_bytes(&t.repo, "f.txt").unwrap()).unwrap();
    assert!(got.contains("L2\n") && !got.contains("l2\n"));
    assert!(got.contains("new-a\n"));
    assert!(got.contains("l18\n"), "second hunk stays unstaged");
}

#[test]
fn stage_only_added_half_of_a_replacement_keeps_old_line() {
    let t = two_hunk_repo();
    let d = diff(&t.repo, "f.txt", false);
    let sel = lines("f.txt", &[find(&d, LineKind::Add, "L2")]);
    LibGit.stage_lines(&t.repo, &sel).unwrap();
    let got = String::from_utf8(index_bytes(&t.repo, "f.txt").unwrap()).unwrap();
    assert!(got.starts_with("l1\nl2\nL2\nl3\n"), "{got}");
}

#[test]
fn empty_selection_is_a_noop() {
    let t = two_hunk_repo();
    let before = index_bytes(&t.repo, "f.txt");
    let sel = LineSelection {
        path: "f.txt".into(),
        options: OPTS,
        hunks: vec![],
    };
    LibGit.stage_lines(&t.repo, &sel).unwrap();
    // Selecting only a context line changes nothing either.
    let sel = lines("f.txt", &[(0, 0)]);
    LibGit.stage_lines(&t.repo, &sel).unwrap();
    assert_eq!(index_bytes(&t.repo, "f.txt"), before);
}

#[test]
fn invalid_selections_are_rejected() {
    let t = two_hunk_repo();
    let mut sel = whole("f.txt", 0);
    sel.options.ignore_whitespace = true;
    assert_eq!(
        LibGit.stage_lines(&t.repo, &sel).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    assert_eq!(
        LibGit
            .stage_lines(&t.repo, &whole("f.txt", 9))
            .unwrap_err()
            .kind,
        ErrorKind::InvalidInput
    );
    assert_eq!(
        LibGit
            .stage_lines(&t.repo, &lines("f.txt", &[(0, 99)]))
            .unwrap_err()
            .kind,
        ErrorKind::InvalidInput
    );
    assert_eq!(
        LibGit
            .stage_lines(&t.repo, &whole("../f.txt", 0))
            .unwrap_err()
            .kind,
        ErrorKind::InvalidInput
    );
    assert_eq!(
        LibGit
            .stage_lines(&t.repo, &whole("missing.txt", 0))
            .unwrap_err()
            .kind,
        ErrorKind::InvalidInput
    );
}

#[test]
fn untracked_file_partial_stage() {
    let mut t = TestRepo::new();
    t.write("base.txt", "x\n");
    t.commit_all("base");
    t.write("new.txt", "one\ntwo\nthree\n");
    let d = diff(&t.repo, "new.txt", false);
    assert_eq!(d.status, ChangeStatus::Untracked);
    let sel = lines(
        "new.txt",
        &[
            find(&d, LineKind::Add, "one"),
            find(&d, LineKind::Add, "three"),
        ],
    );
    LibGit.stage_lines(&t.repo, &sel).unwrap();
    assert_eq!(index_bytes(&t.repo, "new.txt").unwrap(), b"one\nthree\n");
    // The rest ("two") is now an unstaged addition.
    let rest = diff(&t.repo, "new.txt", false);
    assert!(rest
        .hunks
        .iter()
        .flat_map(|h| &h.lines)
        .any(|l| l.kind == LineKind::Add && l.content == "two"));
    // Working tree untouched.
    assert_eq!(
        fs::read(t.root().join("new.txt")).unwrap(),
        b"one\ntwo\nthree\n"
    );
}

#[test]
fn untracked_file_whole_hunk_stage_and_unstage_removes_it() {
    let mut t = TestRepo::new();
    t.write("base.txt", "x\n");
    t.commit_all("base");
    t.write("sub dir/new file.txt", "one\ntwo\n");
    LibGit
        .stage_lines(&t.repo, &whole("sub dir/new file.txt", 0))
        .unwrap();
    assert_eq!(
        index_bytes(&t.repo, "sub dir/new file.txt").unwrap(),
        b"one\ntwo\n"
    );
    LibGit
        .unstage_lines(&t.repo, &whole("sub dir/new file.txt", 0))
        .unwrap();
    assert!(index_bytes(&t.repo, "sub dir/new file.txt").is_none());
    assert!(t.root().join("sub dir/new file.txt").exists());
}

#[test]
fn unstage_selected_lines() {
    let t = two_hunk_repo();
    LibGit.stage_paths(&t.repo, &["f.txt".into()]).unwrap();
    let d = diff(&t.repo, "f.txt", true);
    assert_eq!(d.hunks.len(), 2);
    // Unstage the l18 deletion and the "new-a" addition.
    let sel = lines(
        "f.txt",
        &[
            find(&d, LineKind::Add, "new-a"),
            find(&d, LineKind::Delete, "l18"),
        ],
    );
    LibGit.unstage_lines(&t.repo, &sel).unwrap();
    let mut expect: Vec<String> = numbered(20).lines().map(str::to_string).collect();
    expect[1] = "L2".into();
    let expect = format!("{}\n", expect.join("\n"));
    assert_eq!(index_bytes(&t.repo, "f.txt").unwrap(), expect.as_bytes());
    // Working tree keeps everything.
    let wt = fs::read_to_string(t.root().join("f.txt")).unwrap();
    assert!(wt.contains("new-a") && !wt.contains("l18"));
}

#[test]
fn unstage_whole_hunk_of_a_staged_deletion() {
    let mut t = TestRepo::new();
    t.write("gone.txt", "a\nb\n");
    t.commit_all("base");
    t.remove("gone.txt");
    LibGit.stage_paths(&t.repo, &["gone.txt".into()]).unwrap();
    assert!(index_bytes(&t.repo, "gone.txt").is_none());
    LibGit
        .unstage_lines(&t.repo, &whole("gone.txt", 0))
        .unwrap();
    assert_eq!(index_bytes(&t.repo, "gone.txt").unwrap(), b"a\nb\n");
}

#[test]
fn stage_deleted_file_lines_deletes_from_index() {
    let mut t = TestRepo::new();
    t.write("gone.txt", "a\nb\n");
    t.commit_all("base");
    t.remove("gone.txt");
    LibGit.stage_lines(&t.repo, &whole("gone.txt", 0)).unwrap();
    assert!(index_bytes(&t.repo, "gone.txt").is_none());
}

#[test]
fn no_trailing_newline_round_trip_is_byte_exact() {
    let mut t = TestRepo::new();
    t.write("nonl.txt", "first\nmiddle\nlast");
    t.commit_all("base");
    let new: &[u8] = b"first\nMIDDLE\nlast2";
    t.write("nonl.txt", new);
    let d = diff(&t.repo, "nonl.txt", false);
    LibGit.stage_lines(&t.repo, &whole("nonl.txt", 0)).unwrap();
    assert_eq!(index_bytes(&t.repo, "nonl.txt").unwrap(), new);
    // And back.
    let d2 = diff(&t.repo, "nonl.txt", true);
    assert!(!d2.hunks.is_empty() && !d.hunks.is_empty());
    LibGit
        .unstage_lines(&t.repo, &whole("nonl.txt", 0))
        .unwrap();
    assert_eq!(
        index_bytes(&t.repo, "nonl.txt").unwrap(),
        head_bytes(&t.repo, "nonl.txt").unwrap()
    );
}

#[test]
fn newline_added_at_end_of_file_stages_exactly() {
    let mut t = TestRepo::new();
    t.write("e.txt", "a\nb");
    t.commit_all("base");
    t.write("e.txt", "a\nb\nc\n");
    LibGit.stage_lines(&t.repo, &whole("e.txt", 0)).unwrap();
    assert_eq!(index_bytes(&t.repo, "e.txt").unwrap(), b"a\nb\nc\n");
}

#[test]
fn crlf_content_is_preserved_byte_exactly() {
    let mut t = TestRepo::new();
    let base: &[u8] = b"one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\nseven\r\n";
    t.write("crlf.txt", base);
    t.commit_all("base");
    let new: &[u8] = b"one\r\nTWO\r\nthree\r\nfour\r\nfive\r\nsix\r\nSEVEN\r\n";
    t.write("crlf.txt", new);
    let d = diff(&t.repo, "crlf.txt", false);
    assert_eq!(d.hunks.len(), 2);
    // Stage only the second hunk.
    LibGit.stage_lines(&t.repo, &whole("crlf.txt", 1)).unwrap();
    assert_eq!(
        index_bytes(&t.repo, "crlf.txt").unwrap(),
        b"one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\nSEVEN\r\n"
    );
    // Then the rest as lines.
    let d = diff(&t.repo, "crlf.txt", false);
    let sel = lines(
        "crlf.txt",
        &[
            find(&d, LineKind::Delete, "two\r"),
            find(&d, LineKind::Add, "TWO\r"),
        ],
    );
    LibGit.stage_lines(&t.repo, &sel).unwrap();
    assert_eq!(index_bytes(&t.repo, "crlf.txt").unwrap(), new);
}

#[test]
fn stage_paths_covers_modify_delete_untracked_directories() {
    let mut t = TestRepo::new();
    t.write("mod.txt", "1\n");
    t.write("del.txt", "1\n");
    t.write("dir/gone.txt", "1\n");
    t.write("--upload-pack=x", "dash\n");
    t.commit_all("base");
    t.write("mod.txt", "2\n");
    t.remove("del.txt");
    t.remove("dir/gone.txt");
    t.write("new/a.txt", "a\n");
    t.write("new/deep/b.txt", "b\n");
    t.write("--upload-pack=x", "dash2\n");
    LibGit
        .stage_paths(
            &t.repo,
            &[
                "mod.txt".into(),
                "del.txt".into(),
                "dir".into(),
                "new".into(),
                "--upload-pack=x".into(),
            ],
        )
        .unwrap();
    assert_eq!(index_bytes(&t.repo, "mod.txt").unwrap(), b"2\n");
    assert!(index_bytes(&t.repo, "del.txt").is_none());
    assert!(index_bytes(&t.repo, "dir/gone.txt").is_none());
    assert_eq!(index_bytes(&t.repo, "new/a.txt").unwrap(), b"a\n");
    assert_eq!(index_bytes(&t.repo, "new/deep/b.txt").unwrap(), b"b\n");
    assert_eq!(index_bytes(&t.repo, "--upload-pack=x").unwrap(), b"dash2\n");
    let st = LibGit.status(&t.repo).unwrap();
    assert!(st.unstaged.is_empty(), "{:?}", st.unstaged);
}

#[test]
fn stage_paths_stages_a_rename() {
    let mut t = TestRepo::new();
    t.write(
        "old.txt",
        "some content that is long enough\nto be matched as a rename\n",
    );
    t.commit_all("base");
    fs::rename(t.root().join("old.txt"), t.root().join("renamed.txt")).unwrap();
    LibGit
        .stage_paths(&t.repo, &["old.txt".into(), "renamed.txt".into()])
        .unwrap();
    let st = LibGit.status(&t.repo).unwrap();
    assert_eq!(st.staged.len(), 1);
    assert_eq!(st.staged[0].status, ChangeStatus::Renamed);
    assert_eq!(st.staged[0].old_path.as_deref(), Some("old.txt"));
}

#[test]
fn unstage_paths_restores_head_state() {
    let mut t = TestRepo::new();
    t.write("mod.txt", "1\n");
    t.write("del.txt", "1\n");
    t.write("d/x.txt", "1\n");
    t.commit_all("base");
    t.write("mod.txt", "2\n");
    t.remove("del.txt");
    t.write("d/x.txt", "2\n");
    t.write("d/new.txt", "n\n");
    t.write("added.txt", "n\n");
    t.stage_all();
    LibGit
        .unstage_paths(
            &t.repo,
            &[
                "mod.txt".into(),
                "del.txt".into(),
                "added.txt".into(),
                "d".into(),
            ],
        )
        .unwrap();
    assert!(LibGit.status(&t.repo).unwrap().staged.is_empty());
    assert_eq!(index_bytes(&t.repo, "del.txt").unwrap(), b"1\n");
    assert!(index_bytes(&t.repo, "added.txt").is_none());
    assert!(index_bytes(&t.repo, "d/new.txt").is_none());
    // Working tree untouched.
    assert_eq!(fs::read(t.root().join("mod.txt")).unwrap(), b"2\n");
    // git agrees the index is clean.
    let st = t.repo.statuses(None).unwrap();
    assert!(st.iter().all(|s| !s
        .status()
        .intersects(Status::INDEX_NEW | Status::INDEX_MODIFIED | Status::INDEX_DELETED)));
}

#[test]
fn unstage_paths_on_unborn_head_removes_from_index() {
    let t = TestRepo::new();
    t.write("a.txt", "a\n");
    t.write("b/c.txt", "c\n");
    LibGit
        .stage_paths(&t.repo, &["a.txt".into(), "b".into()])
        .unwrap();
    assert!(index_bytes(&t.repo, "a.txt").is_some());
    LibGit
        .unstage_paths(&t.repo, &["a.txt".into(), "b".into()])
        .unwrap();
    assert!(index_bytes(&t.repo, "a.txt").is_none());
    assert!(index_bytes(&t.repo, "b/c.txt").is_none());
    assert!(t.root().join("a.txt").exists());
}

#[test]
fn path_validation_rejects_escapes() {
    let t = TestRepo::new();
    for bad in [
        "../x",
        "/abs",
        "a/../../x",
        ".git/config",
        "",
        "C:/x",
        "a//b",
    ] {
        for r in [
            LibGit.stage_paths(&t.repo, &[bad.into()]),
            LibGit.unstage_paths(&t.repo, &[bad.into()]),
        ] {
            assert_eq!(r.unwrap_err().kind, ErrorKind::InvalidInput, "{bad}");
        }
        assert_eq!(
            LibGit
                .discard_paths(&t.repo, &[bad.into()], true)
                .unwrap_err()
                .kind,
            ErrorKind::InvalidInput,
            "{bad}"
        );
    }
}

#[test]
fn discard_paths_preview_then_apply_and_undo() {
    let mut t = TestRepo::new();
    t.write("mod.txt", "1\n");
    t.write("del.txt", "1\n");
    t.write("staged.txt", "1\n");
    t.commit_all("base");
    t.write("mod.txt", "2\n");
    t.remove("del.txt");
    t.write("untracked/u.txt", "u\n");
    // A staged change plus a further unstaged one: only the latter is lost.
    t.write("staged.txt", "2\n");
    LibGit.stage_paths(&t.repo, &["staged.txt".into()]).unwrap();
    t.write("staged.txt", "3\n");

    let all: Vec<String> = ["mod.txt", "del.txt", "untracked", "staged.txt"]
        .map(String::from)
        .to_vec();
    let OpOutcome::Preview { preview } = LibGit.discard_paths(&t.repo, &all, true).unwrap() else {
        panic!("expected preview");
    };
    assert_eq!(preview.warnings.len(), 4, "{:?}", preview.warnings);
    assert!(preview
        .warnings
        .iter()
        .any(|w| w.contains("untracked/u.txt")));
    assert_eq!(fs::read(t.root().join("mod.txt")).unwrap(), b"2\n");

    let out = LibGit.discard_paths(&t.repo, &all, false).unwrap();
    assert!(matches!(out, OpOutcome::Applied { .. }));
    assert_eq!(fs::read(t.root().join("mod.txt")).unwrap(), b"1\n");
    assert_eq!(fs::read(t.root().join("del.txt")).unwrap(), b"1\n");
    assert!(!t.root().join("untracked").exists());
    assert_eq!(fs::read(t.root().join("staged.txt")).unwrap(), b"2\n");
    assert_eq!(index_bytes(&t.repo, "staged.txt").unwrap(), b"2\n");

    Oplog::undo(&t.repo, false).unwrap();
    assert_eq!(fs::read(t.root().join("mod.txt")).unwrap(), b"2\n");
    assert!(!t.root().join("del.txt").exists());
    assert_eq!(fs::read(t.root().join("untracked/u.txt")).unwrap(), b"u\n");
    assert_eq!(fs::read(t.root().join("staged.txt")).unwrap(), b"3\n");
    assert_eq!(index_bytes(&t.repo, "staged.txt").unwrap(), b"2\n");
}

#[test]
fn discard_paths_without_changes_is_invalid() {
    let mut t = TestRepo::new();
    t.write("a.txt", "1\n");
    t.commit_all("base");
    assert_eq!(
        LibGit
            .discard_paths(&t.repo, &["a.txt".into()], false)
            .unwrap_err()
            .kind,
        ErrorKind::InvalidInput
    );
}

#[test]
fn discard_lines_reverts_only_the_selection_and_undo_restores() {
    let t = two_hunk_repo();
    let before = fs::read(t.root().join("f.txt")).unwrap();
    let d = diff(&t.repo, "f.txt", false);
    let sel = lines(
        "f.txt",
        &[
            find(&d, LineKind::Add, "new-a"),
            find(&d, LineKind::Delete, "l18"),
        ],
    );
    let OpOutcome::Preview { preview } = LibGit.discard_lines(&t.repo, &sel, true).unwrap() else {
        panic!("expected preview");
    };
    assert!(preview.warnings[0].contains("f.txt"));
    assert_eq!(fs::read(t.root().join("f.txt")).unwrap(), before);

    let out = LibGit.discard_lines(&t.repo, &sel, false).unwrap();
    assert!(matches!(out, OpOutcome::Applied { .. }));
    let mut expect: Vec<String> = numbered(20).lines().map(str::to_string).collect();
    expect[1] = "L2".into();
    let expect = format!("{}\n", expect.join("\n"));
    assert_eq!(fs::read(t.root().join("f.txt")).unwrap(), expect.as_bytes());

    Oplog::undo(&t.repo, false).unwrap();
    assert_eq!(fs::read(t.root().join("f.txt")).unwrap(), before);
}

#[test]
fn discard_lines_of_untracked_and_deleted_files() {
    let mut t = TestRepo::new();
    t.write("gone.txt", "a\nb\n");
    t.commit_all("base");
    t.remove("gone.txt");
    t.write("new.txt", "x\ny\n");
    LibGit
        .discard_lines(&t.repo, &whole("gone.txt", 0), false)
        .unwrap();
    assert_eq!(fs::read(t.root().join("gone.txt")).unwrap(), b"a\nb\n");
    let d = diff(&t.repo, "new.txt", false);
    LibGit
        .discard_lines(
            &t.repo,
            &lines("new.txt", &[find(&d, LineKind::Add, "x")]),
            false,
        )
        .unwrap();
    assert_eq!(fs::read(t.root().join("new.txt")).unwrap(), b"y\n");
    LibGit
        .discard_lines(&t.repo, &whole("new.txt", 0), false)
        .unwrap();
    assert!(!t.root().join("new.txt").exists());
}

// ------------------------------------------------------------------ commit

fn commit_req(message: &str) -> CommitRequest {
    CommitRequest {
        message: message.into(),
        amend: false,
        sign_off: false,
        allow_empty: false,
    }
}

fn head_commit(repo: &Repository) -> git2::Commit<'_> {
    repo.head().unwrap().peel_to_commit().unwrap()
}

#[test]
fn commit_creates_root_commit_on_unborn_head() {
    let t = TestRepo::new();
    set_identity(&t.repo);
    t.write("a.txt", "a\n");
    LibGit.stage_paths(&t.repo, &["a.txt".into()]).unwrap();
    let cli = GitCli::new();
    let out = LibGit
        .commit_create(&t.repo, &cli, &commit_req("first\n\nbody line"))
        .unwrap();
    let OpOutcome::Applied { message, head, .. } = out else {
        panic!("expected applied");
    };
    let c = head_commit(&t.repo);
    assert_eq!(c.parent_count(), 0);
    assert_eq!(c.message().unwrap().trim_end(), "first\n\nbody line");
    assert_eq!(message, format!("Committed {}", &c.id().to_string()[..7]));
    let _ = head;
    // Recorded in the oplog and undoable.
    assert_eq!(
        Oplog::list(&t.repo, 10).unwrap()[0].operation,
        "commit_create"
    );
}

#[test]
fn commit_message_is_never_an_option() {
    let mut t = TestRepo::new();
    set_identity(&t.repo);
    t.write("a.txt", "a\n");
    t.commit_all("base");
    t.write("a.txt", "b\n");
    LibGit.stage_paths(&t.repo, &["a.txt".into()]).unwrap();
    LibGit
        .commit_create(&t.repo, &GitCli::new(), &commit_req("--amend --help"))
        .unwrap();
    assert_eq!(
        head_commit(&t.repo).message().unwrap().trim(),
        "--amend --help"
    );
    assert_eq!(head_commit(&t.repo).parent_count(), 1);
}

#[test]
fn amend_keeps_the_author_and_replaces_message() {
    let mut t = TestRepo::new();
    set_identity(&t.repo);
    t.write("a.txt", "a\n");
    t.commit_all_by("Original Author", "orig@example.com", "first");
    t.write("a.txt", "b\n");
    LibGit.stage_paths(&t.repo, &["a.txt".into()]).unwrap();
    let mut req = commit_req("amended");
    req.amend = true;
    LibGit.commit_create(&t.repo, &GitCli::new(), &req).unwrap();
    let c = head_commit(&t.repo);
    assert_eq!(c.message().unwrap().trim(), "amended");
    assert_eq!(c.author().name().ok(), Some("Original Author"));
    assert_eq!(c.committer().name().ok(), Some("Test User"));
    assert_eq!(c.parent_count(), 0, "amend replaces, not adds");
    assert_eq!(head_bytes(&t.repo, "a.txt").unwrap(), b"b\n");
}

#[test]
fn sign_off_adds_trailer() {
    let mut t = TestRepo::new();
    set_identity(&t.repo);
    t.write("a.txt", "a\n");
    t.commit_all("base");
    t.write("a.txt", "b\n");
    LibGit.stage_paths(&t.repo, &["a.txt".into()]).unwrap();
    let mut req = commit_req("signed");
    req.sign_off = true;
    LibGit.commit_create(&t.repo, &GitCli::new(), &req).unwrap();
    assert!(head_commit(&t.repo)
        .message()
        .unwrap()
        .contains("Signed-off-by: Test User <test@example.com>"));
}

#[test]
fn empty_commit_is_refused_unless_allowed() {
    let mut t = TestRepo::new();
    set_identity(&t.repo);
    t.write("a.txt", "a\n");
    let base = t.commit_all("base");
    let cli = GitCli::new();
    let err = LibGit
        .commit_create(&t.repo, &cli, &commit_req("nothing"))
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    assert_eq!(head_commit(&t.repo).id(), base);
    let mut req = commit_req("empty on purpose");
    req.allow_empty = true;
    LibGit.commit_create(&t.repo, &cli, &req).unwrap();
    assert_eq!(head_commit(&t.repo).parent_id(0).unwrap(), base);
    // Failed attempts are not journaled.
    assert_eq!(Oplog::list(&t.repo, 10).unwrap().len(), 1);
}

#[test]
fn empty_message_is_invalid() {
    let t = TestRepo::new();
    set_identity(&t.repo);
    assert_eq!(
        LibGit
            .commit_create(&t.repo, &GitCli::new(), &commit_req("  \n"))
            .unwrap_err()
            .kind,
        ErrorKind::InvalidInput
    );
}

#[test]
fn missing_identity_is_reported_clearly() {
    let empty = git2::Config::new().unwrap();
    let err = commit::check_identity(&empty).unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    assert!(err.message.contains("user.name") && err.message.contains("user.email"));

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config");
    fs::write(&path, "[user]\n\tname = Someone\n").unwrap();
    let cfg = git2::Config::open(&path).unwrap();
    let err = commit::check_identity(&cfg).unwrap_err();
    assert!(err.message.contains("set user.email") && !err.message.contains("set user.name"));
    fs::write(&path, "[user]\n\tname = Someone\n\temail = a@b.c\n").unwrap();
    assert!(commit::check_identity(&git2::Config::open(&path).unwrap()).is_ok());
}

#[cfg(not(embedded_git))]
#[test]
fn commit_runs_hooks() {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut t = TestRepo::new();
        set_identity(&t.repo);
        t.write("a.txt", "a\n");
        t.commit_all("base");
        let hook = t.repo.path().join("hooks").join("pre-commit");
        fs::create_dir_all(hook.parent().unwrap()).unwrap();
        fs::write(&hook, "#!/bin/sh\necho rejected by hook >&2\nexit 1\n").unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        t.write("a.txt", "b\n");
        LibGit.stage_paths(&t.repo, &["a.txt".into()]).unwrap();
        let err = LibGit
            .commit_create(&t.repo, &GitCli::new(), &commit_req("blocked"))
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::GitCli);
        assert!(err.message.contains("rejected by hook"), "{}", err.message);
    }
}
